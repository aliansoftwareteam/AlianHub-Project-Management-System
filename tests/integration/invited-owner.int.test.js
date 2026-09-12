const { MongoClient, ObjectId } = require('mongodb');
const { createApiClient } = require('../../e2e/support/api');
const { loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { resolveMongoUrl } = require('../../e2e/support/env');

const state = readState();
const anonymous = createApiClient({ baseURL: state.baseURL });
const ROLE_OWNER = 1;

let client;
let ownerSession;
let originalOwnerId;

const owner = async () => {
    if (!ownerSession) ownerSession = await loginAs('owner');
    return ownerSession;
};

const companies = () => client.db('global').collection('companies');
const companyUsers = () => client.db(state.companyId).collection('company_users');

const companyOwnerId = async () => {
    const company = await companies().findOne({ _id: new ObjectId(state.companyId) }, { projection: { userId: 1 } });
    return company && company.userId ? String(company.userId) : '';
};

/* The acceptance handlers answer the browser before they finish writing, so the owner row
 * lands a moment after the response. */
const ownerBecomes = async (userId) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        if (await companyOwnerId() === String(userId)) return true;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
};

/* The invite answers before the company_users row is saved, so the row appears a moment later. */
const invitationRow = async (email) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const row = await companyUsers().findOne({ userEmail: email.toLowerCase() });
        if (row) return row;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`no invitation row for ${email}`);
};

const invite = async (email, role) => {
    const { api } = await owner();
    const sent = await api.post('/api/v2/sendInvitationEmail', {
        email, companyId: state.companyId, companyName: 'E2E Workspace', role, designation: 0,
    });
    expect(sent.status).toBe(200);
    return invitationRow(email);
};

const inviteOwner = (email) => invite(email, ROLE_OWNER);

const inviteBlob = (row) => Buffer.from(
    `userId=${String(row.userId)}&companyId=${state.companyId}&docId=${String(row._id)}&linkId=${row.linkId}`,
    'binary',
).toString('base64');

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    originalOwnerId = await companyOwnerId();
});

afterAll(async () => {
    if (client) {
        if (originalOwnerId) {
            await companies().updateOne({ _id: new ObjectId(state.companyId) }, { $set: { userId: new ObjectId(originalOwnerId) } });
        }
        await client.close();
    }
});

describe('QA-47 an invited owner is recorded as the company owner however they accept', () => {
    it('records the owner when an existing account accepts through /verify-invitation', async () => {
        const email = `invited.owner.verify.${uniqueSuffix()}@e2e.alianhub.test`;
        const created = await anonymous.post('/api/v2/createUser', {
            firstName: 'Vera', lastName: 'Verify', email, password: state.password,
        });
        expect(created.body.status).toBe(true);
        const userId = String(created.body.statusText._id);

        const row = await inviteOwner(email);
        expect(String(row.userId)).toBe(userId);

        const accepted = await anonymous.post('/api/v2/checkPermission', { id: inviteBlob(row) });
        expect(accepted.body.status).toBe(true);
        expect(accepted.body.key).toBe(5);

        expect(await ownerBecomes(userId)).toBe(true);
    });

    it.each([
        ['/api/v2/google-signup', 'googleId'],
        ['/api/v2/github-signup', 'githubId'],
        ['/api/v2/gitlab-signup', 'gitlabId'],
    ])('records the owner when they sign up through %s', async (path, idField) => {
        const suffix = uniqueSuffix();
        const email = `invited.owner.${idField.toLowerCase()}.${suffix}@e2e.alianhub.test`;
        const row = await inviteOwner(email);

        const signup = await anonymous.post(path, {
            firstName: 'Otto', lastName: 'Oauth', email, [idField]: `id-${suffix}`,
            assignCompany: state.companyId, companyUserDocID: String(row._id),
        });
        expect(signup.status).toBe(200);
        const userId = String(signup.body.data._id);

        expect(await ownerBecomes(userId)).toBe(true);
    });

    it('leaves the company owner alone when the invitation is not for an owner', async () => {
        const suffix = uniqueSuffix();
        const email = `invited.member.${suffix}@e2e.alianhub.test`;
        const row = await invite(email, 3);
        const before = await companyOwnerId();

        const signup = await anonymous.post('/api/v2/google-signup', {
            firstName: 'Mia', lastName: 'Member', email, googleId: `id-${suffix}`,
            assignCompany: state.companyId, companyUserDocID: String(row._id),
        });
        expect(signup.status).toBe(200);

        await new Promise((resolve) => setTimeout(resolve, 1000));
        expect(await companyOwnerId()).toBe(before);
    });
});

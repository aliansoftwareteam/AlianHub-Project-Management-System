const { MongoClient, ObjectId } = require('mongodb');
const { createApiClient } = require('../../e2e/support/api');
const { PASSWORD, assertOk, login, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { resolveMongoUrl } = require('../../e2e/support/env');

const state = readState();
const companyId = state.companyId;
const anonymous = createApiClient({ baseURL: state.baseURL });
const PENDING = 1;

let client;
const companyUsers = () => client.db(companyId).collection('company_users');

const inviteAndRegister = async () => {
    const { api: ownerApi } = await loginAs('owner');
    const email = `retire-${uniqueSuffix()}@e2e.alianhub.test`;
    const sent = await ownerApi.post('/api/v2/sendInvitationEmail', { email, companyId, companyName: state.companyName, role: 3, designation: 0 });
    const invitation = sent.body && sent.body.data;
    if (!invitation || !invitation._id) throw new Error(`invite failed (${sent.status}): ${JSON.stringify(sent.body).slice(0, 300)}`);
    const memberId = String(invitation._id);
    const { linkId } = await companyUsers().findOne({ _id: new ObjectId(memberId) }, { projection: { linkId: 1 } });

    assertOk(await anonymous.post('/api/v2/createUser', {
        firstName: 'Rhea', lastName: 'Retired', email, password: PASSWORD, isInvitation: true, assignCompany: companyId, memberId, linkId,
    }), `register ${email}`);
    const session = await login(state.baseURL, email);
    const api = createApiClient({ baseURL: state.baseURL, accessToken: session.accessToken, companyId });
    return { memberId, linkId, uid: String(session.uid), api };
};

const acceptThroughInvitationPage = (invited) => invited.api.put('/api/v1/root-members', {
    id: invited.memberId, data: { userId: invited.uid, status: 2 }, companyId,
});

const preview = (invited) => anonymous.post('/api/v2/auth/invitation-preview', { companyId, memberId: invited.memberId, linkId: invited.linkId });

const acceptThroughLink = (invited) => anonymous.post('/api/v2/checkPermission', {
    id: Buffer.from(`userId=${invited.uid}&companyId=${companyId}&docId=${invited.memberId}&linkId=${invited.linkId}`, 'binary').toString('base64'),
});

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
});

afterAll(async () => {
    if (client) await client.close();
});

describe('accepting an invitation from the invitation page', () => {
    it('retires the link it was accepted with', async () => {
        const invited = await inviteAndRegister();
        expect((await preview(invited)).body.status).toBe(true);

        assertOk(await acceptThroughInvitationPage(invited), 'accept invitation');

        const row = await companyUsers().findOne({ _id: new ObjectId(invited.memberId) }, { projection: { linkId: 1 } });
        expect(row.linkId).toBeFalsy();
    });

    it('refuses the same link afterwards, even if the seat is set back to pending', async () => {
        const invited = await inviteAndRegister();
        assertOk(await acceptThroughInvitationPage(invited), 'accept invitation');
        await companyUsers().updateOne({ _id: new ObjectId(invited.memberId) }, { $set: { status: PENDING } });

        expect((await preview(invited)).body.status).toBe(false);
        expect((await acceptThroughLink(invited)).body.status).toBe(false);
    });
});

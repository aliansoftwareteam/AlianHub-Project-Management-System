const crypto = require('node:crypto');
const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createApiClient } = require('../../e2e/support/api');
const { inviteMember, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const FOREIGN_COMPANY = crypto.randomBytes(12).toString('hex');
const suffix = uniqueSuffix();
const OUTSIDER_EMAIL = `outsider.${suffix}@elsewhere.test`;
const UNKNOWN_EMAIL = `nobody.${suffix}@elsewhere.test`;

let client;
let outsiderId;

const users = () => client.db('global').collection('users');
const companyUsers = () => client.db(state.companyId).collection('company_users');

/* The fields that differ between any two invitations regardless of who is invited. */
const VARYING = ['_id', 'userEmail', 'linkId', 'sendInvitationTime', 'createdAt', 'updatedAt'];
const comparable = (row) => Object.fromEntries(Object.entries(row || {}).filter(([key]) => !VARYING.includes(key)));

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    await client.db('global').collection('companies').insertOne({ _id: new ObjectId(FOREIGN_COMPANY), Cst_CompanyName: 'Foreign Co' });
    const inserted = await users().insertOne({
        Employee_Email: OUTSIDER_EMAIL, Employee_Name: 'Out Sider', Employee_FName: 'Out', Employee_LName: 'Sider',
        isActive: true, isEmailVerified: true, isOnline: true, AssignCompany: [FOREIGN_COMPANY],
    });
    outsiderId = String(inserted.insertedId);
    await client.db(FOREIGN_COMPANY).collection('company_users').insertOne({ userId: outsiderId, roleType: 1, status: 2, isDelete: false, userEmail: OUTSIDER_EMAIL });
});

afterAll(async () => {
    if (!client) return;
    await companyUsers().deleteMany({ userEmail: { $in: [OUTSIDER_EMAIL, UNKNOWN_EMAIL] } });
    await users().deleteOne({ _id: new ObjectId(outsiderId) });
    await client.db('global').collection('companies').deleteOne({ _id: new ObjectId(FOREIGN_COMPANY) });
    await client.db(FOREIGN_COMPANY).dropDatabase();
    await client.close();
});

describe('inviting an address', () => {
    const invite = (api, email) => api.post('/api/v2/sendInvitationEmail', {
        email, companyId: state.companyId, companyName: state.companyName, role: 3, designation: 0, isResend: true,
    });

    it('answers for a person registered in another company exactly as for an unknown address', async () => {
        const owner = await loginAs('owner');
        const outsider = await invite(owner.api, OUTSIDER_EMAIL);
        const unknown = await invite(owner.api, UNKNOWN_EMAIL);

        expect(outsider.status).toBe(unknown.status);
        expect(comparable(outsider.body.data)).toEqual(comparable(unknown.body.data));
        expect({ ...outsider.body, data: undefined }).toEqual({ ...unknown.body, data: undefined });
        expect(JSON.stringify(outsider.body)).not.toContain(outsiderId);
    });

    it('lists both pending invitations the same way to the company', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.get('/api/v1/members');
        const rowFor = (email) => res.body.data.find((row) => row.userEmail === email);

        expect(res.status).toBe(200);
        expect(comparable(rowFor(OUTSIDER_EMAIL))).toEqual(comparable(rowFor(UNKNOWN_EMAIL)));
        expect(JSON.stringify(res.body)).not.toContain(outsiderId);
    });

    it('still lists an active member with their user id', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.get('/api/v1/members');

        const member = res.body.data.find((row) => row.userEmail === state.users.member.email);
        expect(member.userId).toBe(state.users.member.userId);
    });
});

describe('POST /api/v2/logout', () => {
    it('never marks another person offline, whatever id the body names', async () => {
        await users().updateOne({ _id: new ObjectId(outsiderId) }, { $set: { isOnline: true } });
        const member = await loginAs('member');

        const res = await member.api.post('/api/v2/logout', { id: outsiderId });

        expect(res.status).toBe(200);
        expect((await users().findOne({ _id: new ObjectId(outsiderId) })).isOnline).toBe(true);
        expect((await users().findOne({ _id: new ObjectId(member.userId) })).isOnline).toBe(false);
    });
});

describe('a company header whose seat is gone', () => {
    it('is refused even while the account still lists the company', async () => {
        const owner = await loginAs('owner');
        const email = `removed.${suffix}@e2e.alianhub.test`;
        const removed = await inviteMember({
            baseURL: state.baseURL, ownerApi: owner.api, companyId: state.companyId, role: 'member', email, firstName: 'Re', lastName: 'Moved',
        });
        const session = await createApiClient({ baseURL: state.baseURL }).post('/api/v2/auth/login', { email, password: state.password });
        const api = createApiClient({ baseURL: state.baseURL, accessToken: session.body.accessToken, companyId: state.companyId });

        try {
            expect((await api.get('/api/v1/members')).status).toBe(200);

            await companyUsers().updateOne({ userId: removed.userId }, { $set: { isDelete: true } });
            expect(await users().countDocuments({ _id: new ObjectId(removed.userId), AssignCompany: state.companyId })).toBe(1);

            const refused = await api.get('/api/v1/members');
            expect(refused.status).toBe(403);
        } finally {
            await companyUsers().deleteOne({ userId: removed.userId });
            await users().updateOne({ _id: new ObjectId(removed.userId) }, { $pull: { AssignCompany: state.companyId } });
        }
    });
});

const { MongoClient, ObjectId } = require('mongodb');
const { createApiClient } = require('../../e2e/support/api');
const { PASSWORD, assertOk, login, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { resolveMongoUrl } = require('../../e2e/support/env');

const state = readState();
const companyId = state.companyId;
const anonymous = createApiClient({ baseURL: state.baseURL });

let client;
const companyUsers = () => client.db(companyId).collection('company_users');
const rowOf = (memberId) => companyUsers().findOne({ _id: new ObjectId(memberId) }, { projection: { status: 1, isDelete: 1, userId: 1, roleType: 1 } });

const inviteAndRegister = async () => {
    const { api: ownerApi } = await loginAs('owner');
    const email = `pending-${uniqueSuffix()}@e2e.alianhub.test`;
    const sent = await ownerApi.post('/api/v2/sendInvitationEmail', { email, companyId, companyName: state.companyName, role: 3, designation: 0 });
    const invitation = sent.body && sent.body.data;
    if (!invitation || !invitation._id) throw new Error(`invite failed (${sent.status}): ${JSON.stringify(sent.body).slice(0, 300)}`);
    const memberId = String(invitation._id);
    const { linkId } = await companyUsers().findOne({ _id: new ObjectId(memberId) }, { projection: { linkId: 1 } });

    assertOk(await anonymous.post('/api/v2/createUser', {
        firstName: 'Petra', lastName: 'Pending', email, password: PASSWORD, isInvitation: true, assignCompany: companyId, memberId, linkId,
    }), `register ${email}`);
    const session = await login(state.baseURL, email);
    const api = createApiClient({ baseURL: state.baseURL, accessToken: session.accessToken, companyId });
    return { memberId, linkId, uid: String(session.uid), api };
};

const accept = (invited) => invited.api.put('/api/v1/root-members', {
    id: invited.memberId, data: { userId: invited.uid, status: 2 }, companyId, linkId: invited.linkId,
});

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
});

afterAll(async () => {
    if (client) await client.close();
});

describe('root-members accepts only a pending invitation', () => {
    it('accepts a pending invitation', async () => {
        const invited = await inviteAndRegister();
        assertOk(await accept(invited), 'accept pending invitation');
        const row = await rowOf(invited.memberId);
        expect(row.status).toBe(2);
        expect(String(row.userId)).toBe(invited.uid);
    });

    it.each([
        ['withdrawn', { status: 3, isDelete: true }],
        ['removed', { status: 2, isDelete: true }],
        ['deactivated', { status: 0 }],
    ])('leaves a %s seat as the admin set it', async (label, adminChange) => {
        const invited = await inviteAndRegister();
        assertOk(await accept(invited), 'accept pending invitation');
        await companyUsers().updateOne({ _id: new ObjectId(invited.memberId) }, { $set: adminChange });
        const before = await rowOf(invited.memberId);

        const again = await accept(invited);

        expect(again.status).toBe(403);
        expect(again.body.status).toBe(false);
        expect(await rowOf(invited.memberId)).toEqual(before);
    });

    it('refuses a withdrawn invitation that was never accepted', async () => {
        const invited = await inviteAndRegister();
        await companyUsers().updateOne({ _id: new ObjectId(invited.memberId) }, { $set: { status: 3, isDelete: true } });
        const before = await rowOf(invited.memberId);

        const answer = await accept(invited);

        expect(answer.status).toBe(403);
        expect(await rowOf(invited.memberId)).toEqual(before);
    });
});

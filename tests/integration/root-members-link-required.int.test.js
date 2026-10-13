const crypto = require('node:crypto');
const { MongoClient, ObjectId } = require('mongodb');
const { createApiClient } = require('../../e2e/support/api');
const { PASSWORD, assertOk, login, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { resolveMongoUrl } = require('../../e2e/support/env');

const state = readState();
const companyId = state.companyId;
const anonymous = createApiClient({ baseURL: state.baseURL });

let client;
const companyUsers = () => client.db(companyId).collection('company_users');
const rowOf = (memberId) => companyUsers().findOne({ _id: new ObjectId(memberId) }, { projection: { status: 1, isDelete: 1, userId: 1, roleType: 1, linkId: 1 } });

const sendInvitation = async () => {
    const { api: ownerApi } = await loginAs('owner');
    const email = `linkreq-${uniqueSuffix()}@e2e.alianhub.test`;
    const sent = await ownerApi.post('/api/v2/sendInvitationEmail', { email, companyId, companyName: state.companyName, role: 3, designation: 0 });
    const invitation = sent.body && sent.body.data;
    if (!invitation || !invitation._id) throw new Error(`invite failed (${sent.status}): ${JSON.stringify(sent.body).slice(0, 300)}`);
    const memberId = String(invitation._id);
    const { linkId } = await companyUsers().findOne({ _id: new ObjectId(memberId) }, { projection: { linkId: 1 } });
    return { email, memberId, linkId };
};

const inviteAndRegister = async () => {
    const { email, memberId, linkId } = await sendInvitation();
    assertOk(await anonymous.post('/api/v2/createUser', {
        firstName: 'Lina', lastName: 'Link', email, password: PASSWORD, isInvitation: true, assignCompany: companyId, memberId, linkId,
    }), `register ${email}`);
    const session = await login(state.baseURL, email);
    const api = createApiClient({ baseURL: state.baseURL, accessToken: session.accessToken, companyId });
    return { memberId, linkId, uid: String(session.uid), api };
};

const accept = (invited, link) => invited.api.put('/api/v1/root-members', {
    id: invited.memberId, data: { userId: invited.uid, status: 2 }, companyId, ...link,
});

const answerOf = (res) => ({ status: res.status, body: res.body });

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
});

afterAll(async () => {
    if (client) await client.close();
});

describe('root-members accepts an invitation only with its link', () => {
    it('accepts a pending invitation for its own account with its link token', async () => {
        const invited = await inviteAndRegister();

        assertOk(await accept(invited, { linkId: invited.linkId }), 'accept with the link token');

        const row = await rowOf(invited.memberId);
        expect(row.status).toBe(2);
        expect(String(row.userId)).toBe(invited.uid);
        expect(row.linkId).toBeFalsy();
    });

    it.each([
        ['no token', () => ({})],
        ['an empty token', () => ({ linkId: '' })],
        ['a wrong token', () => ({ linkId: crypto.randomBytes(32).toString('hex') })],
        ['the token of another invitation', (other) => ({ linkId: other.linkId })],
    ])('refuses %s and leaves the invitation pending', async (_label, linkFor) => {
        const invited = await inviteAndRegister();
        const other = await sendInvitation();
        const before = await rowOf(invited.memberId);

        const answer = await accept(invited, linkFor(other));

        expect(answer.status).toBe(403);
        expect(answer.body.status).toBe(false);
        const after = await rowOf(invited.memberId);
        expect(after).toEqual(before);
        expect(after.status).toBe(1);
        expect(after.linkId).toBe(invited.linkId);
    });

    it('answers a missing or wrong token exactly as it answers an invitation that is no longer pending', async () => {
        const invited = await inviteAndRegister();
        const withdrawn = await inviteAndRegister();
        await companyUsers().updateOne({ _id: new ObjectId(withdrawn.memberId) }, { $set: { status: 3, isDelete: true } });

        const notPending = answerOf(await accept(withdrawn, { linkId: withdrawn.linkId }));
        const missing = answerOf(await accept(invited, {}));
        const wrong = answerOf(await accept(invited, { linkId: crypto.randomBytes(32).toString('hex') }));

        expect(notPending.status).toBe(403);
        expect(missing).toEqual(notPending);
        expect(wrong).toEqual(notPending);
    });

    it('still refuses the right link from another account', async () => {
        const invited = await inviteAndRegister();
        const stranger = await inviteAndRegister();

        const answer = await stranger.api.put('/api/v1/root-members', {
            id: invited.memberId, data: { userId: stranger.uid, status: 2 }, companyId, linkId: invited.linkId,
        });

        expect(answer.status).toBe(403);
        const row = await rowOf(invited.memberId);
        expect(row.status).toBe(1);
        expect(row.linkId).toBe(invited.linkId);
    });
});

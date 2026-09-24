const { MongoClient, ObjectId } = require('mongodb');
const { createApiClient } = require('../../e2e/support/api');
const { login, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { resolveMongoUrl } = require('../../e2e/support/env');

const state = readState();
const anonymous = createApiClient({ baseURL: state.baseURL });
const ROLE_MEMBER = 3;
const TRANSPORT_DETAIL = /ECONNREFUSED|127\.0\.0\.1|connect |ETIMEDOUT|EHOSTUNREACH|getaddrinfo|:9\b/i;
// The join link names this harness's own host, so it is left out of the transport check.
const withoutLink = (body) => JSON.stringify({ ...body, joinLink: undefined });

let client;
const companyUsers = () => client.db(state.companyId).collection('company_users');
const users = () => client.db('global').collection('users');
const row = (id) => companyUsers().findOne({ _id: new ObjectId(String(id)) });
const freshEmail = (label) => `${label}.${uniqueSuffix()}@e2e.alianhub.test`;

const sendInvite = async (email, extra = {}) => {
    const { api } = await loginAs('owner');
    return api.post('/api/v2/sendInvitationEmail', {
        email, companyId: state.companyId, companyName: state.companyName, role: ROLE_MEMBER, designation: 0, ...extra,
    });
};

/* The link the Members screen copies: `…/#/invitation?companyId=<company>-<row>&token=<token>`. */
const partsOf = (link) => {
    const query = new URLSearchParams(String(link).split('?')[1] || '');
    const [companyId, memberId] = String(query.get('companyId') || '').split('-');
    return { companyId, memberId, linkId: query.get('token') || '' };
};

const register = (email, parts) => anonymous.post('/api/v2/createUser', {
    firstName: 'Jo', lastName: 'Joiner', email, password: state.password,
    isInvitation: true, assignCompany: parts.companyId, memberId: parts.memberId, linkId: parts.linkId,
});

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
});
afterAll(async () => { if (client) await client.close(); });

describe('sending an invite while mail is down', () => {
    it('answers with a plain status, the saved row and its join link, and no transport detail', async () => {
        const email = freshEmail('mailfail.plain');
        const res = await sendInvite(email);

        expect(res.status).toBe(200);
        expect(res.body.status).toBe(false);
        expect(res.body.statusText).toBe('Invitation_mail_failed');
        expect(withoutLink(res.body)).not.toMatch(TRANSPORT_DETAIL);
        expect(res.body.data).toEqual(expect.objectContaining({ userEmail: email, status: 1 }));

        const saved = await row(res.body.data._id);
        const parts = partsOf(res.body.joinLink);
        expect(res.body.joinLink).toMatch(/\/#\/invitation\?companyId=[a-f0-9]{24}-[a-f0-9]{24}&token=/);
        expect(parts).toEqual({ companyId: state.companyId, memberId: String(saved._id), linkId: saved.linkId });
    });

    it('answers a resend the same way', async () => {
        const email = freshEmail('mailfail.resend');
        await sendInvite(email);
        const res = await sendInvite(email, { isResend: true });
        expect(res.body).toEqual(expect.objectContaining({ status: false, statusText: 'Invitation_mail_failed' }));
        expect(withoutLink(res.body)).not.toMatch(TRANSPORT_DETAIL);
        expect(partsOf(res.body.joinLink).linkId).toBe((await row(res.body.data._id)).linkId);
    });
});

describe('the copied join link', () => {
    it('opens the invitation', async () => {
        const res = await sendInvite(freshEmail('joinlink.preview'));
        const parts = partsOf(res.body.joinLink);
        const preview = await anonymous.post('/api/v2/auth/invitation-preview', parts);
        expect(preview.body).toEqual(expect.objectContaining({ status: true }));
        expect(preview.body.data).toEqual(expect.objectContaining({ status: 1, email: res.body.data.userEmail }));
    });

    it('does not admit an account for another address', async () => {
        const invited = freshEmail('joinlink.invited');
        const res = await sendInvite(invited);
        const parts = partsOf(res.body.joinLink);

        const intruder = await register(freshEmail('joinlink.intruder'), parts);
        expect(intruder.body.status).toBe(true);
        expect(intruder.body.statusText.AssignCompany).toEqual([]);
        expect(intruder.body.statusText.isEmailVerified).toBe(false);

        // Verified by hand so the intruder can sign in and try to claim the seat directly.
        await users().updateOne({ _id: new ObjectId(String(intruder.body.statusText._id)) }, { $set: { isEmailVerified: true } });
        const intruderSession = await login(state.baseURL, intruder.body.statusText.Employee_Email, state.password);
        const intruderApi = createApiClient({ baseURL: state.baseURL, accessToken: intruderSession.accessToken, companyId: parts.companyId });
        const claim = await intruderApi.put('/api/v1/root-members', {
            id: parts.memberId, data: { userId: intruderSession.uid, status: 2 }, companyId: parts.companyId,
        });
        expect(claim.body.status).not.toBe(true);

        const after = await row(parts.memberId);
        expect(after.status).toBe(1);
        expect(String(after.userId || '')).toBe('');
    });

    it('admits the invited account', async () => {
        const invited = freshEmail('joinlink.owner');
        const res = await sendInvite(invited);
        const parts = partsOf(res.body.joinLink);

        const created = await register(invited, parts);
        expect(created.body.status).toBe(true);
        expect(created.body.statusText.AssignCompany).toEqual([state.companyId]);

        const session = await login(state.baseURL, invited, state.password);
        const api = createApiClient({ baseURL: state.baseURL, accessToken: session.accessToken, companyId: parts.companyId });
        const accepted = await api.put('/api/v1/root-members', {
            id: parts.memberId, data: { userId: session.uid, status: 2 }, companyId: parts.companyId,
        });
        expect(accepted.body.status).toBe(true);
        expect((await row(parts.memberId)).status).toBe(2);
        expect((await users().findOne({ _id: new ObjectId(session.uid) })).AssignCompany).toContain(state.companyId);
    });
});

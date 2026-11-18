const crypto = require('node:crypto');
const { MongoClient, ObjectId } = require('mongodb');
const { createApiClient } = require('../../e2e/support/api');
const { loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { resolveMongoUrl } = require('../../e2e/support/env');

const state = readState();
const anonymous = createApiClient({ baseURL: state.baseURL });
const ROLE_OWNER = 1;
const ROLE_MEMBER = 3;

let client;
let originalOwnerId;
const createdOwnerRows = [];

const users = () => client.db('global').collection('users');
const companies = () => client.db('global').collection('companies');
const companyUsers = () => client.db(state.companyId).collection('company_users');

const companyOwnerId = async () => {
    const company = await companies().findOne({ _id: new ObjectId(state.companyId) }, { projection: { userId: 1 } });
    return company && company.userId ? String(company.userId) : '';
};

const account = (id) => users().findOne({ _id: new ObjectId(String(id)) });
const row = (id) => companyUsers().findOne({ _id: new ObjectId(String(id)) });
const settle = () => new Promise((resolve) => setTimeout(resolve, 1000));

const invite = async (email, role = ROLE_MEMBER) => {
    const { api } = await loginAs('owner');
    const sent = await api.post('/api/v2/sendInvitationEmail', {
        email, companyId: state.companyId, companyName: state.companyName, role, designation: 0,
    });
    const invitation = sent.body && sent.body.data;
    if (!invitation || !invitation._id) throw new Error(`invite failed (${sent.status}): ${JSON.stringify(sent.body).slice(0, 300)}`);
    if (role === ROLE_OWNER) createdOwnerRows.push(String(invitation._id));
    return row(invitation._id);
};

const signUp = async (email) => {
    const created = await anonymous.post('/api/v2/createUser', { firstName: 'Ina', lastName: 'Invitee', email, password: state.password });
    expect(created.body.status).toBe(true);
    return String(created.body.statusText._id);
};

const blob = ({ userId, docId, linkId }) => Buffer.from(
    `userId=${userId}&companyId=${state.companyId}&docId=${docId}&linkId=${linkId}`,
    'binary',
).toString('base64');

const accept = (fields) => anonymous.post('/api/v2/checkPermission', { id: blob(fields) });
const preview = (body) => anonymous.post('/api/v2/auth/invitation-preview', body);
const freshEmail = (label) => `${label}.${uniqueSuffix()}@e2e.alianhub.test`;

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    originalOwnerId = await companyOwnerId();
});

afterAll(async () => {
    if (!client) return;
    if (originalOwnerId) {
        await companies().updateOne({ _id: new ObjectId(state.companyId) }, { $set: { userId: new ObjectId(originalOwnerId) } });
    }
    if (createdOwnerRows.length) {
        await companyUsers().updateMany({ _id: { $in: createdOwnerRows.map((id) => new ObjectId(id)) } }, { $set: { roleType: ROLE_MEMBER } });
    }
    await client.close();
});

describe('accepting an invitation through its link', () => {
    it('adds the company to the account the invitation was sent to', async () => {
        const email = freshEmail('bind.accept');
        const userId = await signUp(email);
        const invitation = await invite(email);

        const res = await accept({ userId, docId: invitation._id, linkId: invitation.linkId });
        expect(res.body).toMatchObject({ status: true, key: 5, companyId: state.companyId });

        expect((await account(userId)).AssignCompany).toContain(state.companyId);
        expect((await row(invitation._id)).status).toBe(2);
    });

    it('refuses the link for any other account and changes nothing', async () => {
        const email = freshEmail('bind.intended');
        const intended = await signUp(email);
        const other = await signUp(freshEmail('bind.other'));
        const invitation = await invite(email, ROLE_OWNER);
        const ownerBefore = await companyOwnerId();

        const res = await accept({ userId: other, docId: invitation._id, linkId: invitation.linkId });
        expect(res.body.status).toBe(false);
        await settle();

        expect((await account(other)).AssignCompany || []).not.toContain(state.companyId);
        expect((await account(intended)).AssignCompany || []).not.toContain(state.companyId);
        const after = await row(invitation._id);
        expect(after.status).toBe(1);
        expect(after.linkId).toBe(invitation.linkId);
        expect(await companyOwnerId()).toBe(ownerBefore);
    });

    it('answers a missing, unknown and mismatched account alike', async () => {
        const email = freshEmail('bind.alike');
        await signUp(email);
        const other = await signUp(freshEmail('bind.alike.other'));
        const invitation = await invite(email);
        const link = { docId: invitation._id, linkId: invitation.linkId };

        const mismatched = await accept({ ...link, userId: other });
        const unknown = await accept({ ...link, userId: new ObjectId().toString() });
        const missing = await anonymous.post('/api/v2/checkPermission', {
            id: Buffer.from(`companyId=${state.companyId}&docId=${invitation._id}&linkId=${invitation.linkId}`, 'binary').toString('base64'),
        });

        expect(unknown.body).toEqual(mismatched.body);
        expect(missing.body).toEqual(mismatched.body);
        expect(mismatched.body.status).toBe(false);
    });

    it('refuses a link carrying the wrong token', async () => {
        const email = freshEmail('bind.token');
        const userId = await signUp(email);
        const invitation = await invite(email);

        const res = await accept({ userId, docId: invitation._id, linkId: crypto.randomBytes(32).toString('hex') });
        expect(res.body.status).toBe(false);
        await settle();
        expect((await account(userId)).AssignCompany || []).not.toContain(state.companyId);
    });

    it('refuses an invitation that was removed', async () => {
        const email = freshEmail('bind.removed');
        const userId = await signUp(email);
        const invitation = await invite(email);
        await companyUsers().updateOne({ _id: invitation._id }, { $set: { status: 3 } });

        const res = await accept({ userId, docId: invitation._id, linkId: invitation.linkId });
        expect(res.body.status).toBe(false);
        await settle();
        expect((await account(userId)).AssignCompany || []).not.toContain(state.companyId);
        expect((await row(invitation._id)).status).toBe(3);
    });

    it('accepts an invitation to an address only for an account that verified that address', async () => {
        const email = freshEmail('bind.byemail');
        const invitation = await invite(email);
        expect(String(invitation.userId || '')).toBe('');
        const userId = await signUp(email);

        const unverified = await accept({ userId, docId: invitation._id, linkId: invitation.linkId });
        expect(unverified.body.status).toBe(false);
        await settle();
        expect((await row(invitation._id)).status).toBe(1);

        await users().updateOne({ _id: new ObjectId(userId) }, { $set: { isEmailVerified: true } });
        const verified = await accept({ userId, docId: invitation._id, linkId: invitation.linkId });
        expect(verified.body).toMatchObject({ status: true, key: 5 });
        expect((await account(userId)).AssignCompany).toContain(state.companyId);
    });
});

describe('signing up from an invitation link', () => {
    const register = (email, extra) => anonymous.post('/api/v2/createUser', {
        firstName: 'Nia', lastName: 'New', email, password: state.password, isInvitation: true, assignCompany: state.companyId, ...extra,
    });

    it('joins the company with the link token and invitation id', async () => {
        const email = freshEmail('signup.link');
        const invitation = await invite(email);

        const res = await register(email, { memberId: String(invitation._id), linkId: invitation.linkId });
        expect(res.body.status).toBe(true);
        expect(res.body.statusText.AssignCompany).toEqual([state.companyId]);
        expect(res.body.statusText.isEmailVerified).toBe(true);
    });

    it.each([
        ['nothing but the address', () => ({})],
        ['the invitation id without the token', (invitation) => ({ memberId: String(invitation._id) })],
        ['the invitation id with a wrong token', (invitation) => ({ memberId: String(invitation._id), linkId: crypto.randomBytes(32).toString('hex') })],
        ['the token for another invitation id', (invitation) => ({ memberId: new ObjectId().toString(), linkId: invitation.linkId })],
    ])('does not join the company with %s', async (_label, extra) => {
        const email = freshEmail('signup.claim');
        const invitation = await invite(email);

        const res = await register(email, extra(invitation));
        expect(res.body.status).toBe(true);
        expect(res.body.statusText.AssignCompany).toEqual([]);
        expect(res.body.statusText.isEmailVerified).toBe(false);
        expect((await row(invitation._id)).status).toBe(1);
    });
});

describe('previewing an invitation', () => {
    it('refuses once the invitation was accepted through its link', async () => {
        const email = freshEmail('preview.accepted');
        const userId = await signUp(email);
        const invitation = await invite(email);
        const accepted = await accept({ userId, docId: invitation._id, linkId: invitation.linkId });
        expect(accepted.body.key).toBe(5);
        await settle();

        for (const linkId of [undefined, '', invitation.linkId]) {
            const res = await preview({ companyId: state.companyId, memberId: String(invitation._id), linkId });
            expect(res.body.status).toBe(false);
            expect(res.body.data).toBeUndefined();
        }
    });

    it('refuses once the invitee signed up and joined', async () => {
        const email = freshEmail('preview.joined');
        const invitation = await invite(email);
        await companyUsers().updateOne({ _id: invitation._id }, { $set: { status: 2 } });

        const res = await preview({ companyId: state.companyId, memberId: String(invitation._id), linkId: invitation.linkId });
        expect(res.body.status).toBe(false);
        expect(res.body.data).toBeUndefined();
    });

    it('refuses an invitation that was removed', async () => {
        const email = freshEmail('preview.removed');
        const invitation = await invite(email);
        await companyUsers().updateOne({ _id: invitation._id }, { $set: { status: 3 } });

        const res = await preview({ companyId: state.companyId, memberId: String(invitation._id), linkId: invitation.linkId });
        expect(res.body.status).toBe(false);
        expect(res.body.data).toBeUndefined();
    });

    it('refuses an invitation stored without a token', async () => {
        const email = freshEmail('preview.notoken');
        const invitation = await invite(email);
        await companyUsers().updateOne({ _id: invitation._id }, { $set: { linkId: '' } });

        const res = await preview({ companyId: state.companyId, memberId: String(invitation._id), linkId: '' });
        expect(res.body.status).toBe(false);
    });
});

describe('verifying an email address', () => {
    const verify = (uid) => anonymous.post('/api/v2/verifyEmail', { uid, token: crypto.randomBytes(32).toString('hex') });

    it('answers an unknown, a verified and an expired account alike, without the address', async () => {
        const email = freshEmail('verify.alike');
        const unverified = await signUp(email);

        const unknown = await verify(new ObjectId().toString());
        const verified = await verify(state.users.owner.userId);
        const expired = await verify(unverified);

        expect(verified.body).toEqual(unknown.body);
        expect(expired.body).toEqual(unknown.body);
        expect(unknown.body.status).toBe(false);
        for (const res of [unknown, verified, expired]) {
            expect(JSON.stringify(res.body)).not.toMatch(/@/);
        }
    });

    it('still verifies with the token from the email', async () => {
        const email = freshEmail('verify.ok');
        const uid = await signUp(email);
        const token = crypto.randomBytes(32).toString('hex');
        await users().updateOne({ _id: new ObjectId(uid) }, { $set: { verificationToken: token, verificationTokenTime: new Date() } });

        const res = await anonymous.post('/api/v2/verifyEmail', { uid, token });
        expect(res.body.status).toBe(true);
        expect((await account(uid)).isEmailVerified).toBe(true);
    });
});

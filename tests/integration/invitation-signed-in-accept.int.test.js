const crypto = require('node:crypto');
const { MongoClient, ObjectId } = require('mongodb');
const { createApiClient } = require('../../e2e/support/api');
const { PASSWORD, login, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { resolveMongoUrl } = require('../../e2e/support/env');

const state = readState();
const companyId = state.companyId;
const anonymous = createApiClient({ baseURL: state.baseURL });
const PENDING = 1;
const ACTIVE = 2;

let client;
const users = () => client.db('global').collection('users');
const companyUsers = () => client.db(companyId).collection('company_users');
const row = (id) => companyUsers().findOne({ _id: new ObjectId(String(id)) });
const companiesOf = async (userId) => ((await users().findOne({ _id: new ObjectId(userId) }, { projection: { AssignCompany: 1 } })) || {}).AssignCompany || [];
const freshEmail = (label) => `${label}.${uniqueSuffix()}@e2e.alianhub.test`;
const settle = () => new Promise((resolve) => setTimeout(resolve, 1000));

/* An account made outside any invitation. Signing in needs a verified address. */
const registeredAccount = async (email) => {
    const created = await anonymous.post('/api/v2/createUser', { firstName: 'Esme', lastName: 'Existing', email, password: PASSWORD });
    expect(created.body.status).toBe(true);
    const userId = String(created.body.statusText._id);
    await users().updateOne({ _id: new ObjectId(userId) }, { $set: { isEmailVerified: true } });
    const session = await login(state.baseURL, email);
    return { userId, email, api: createApiClient({ baseURL: state.baseURL, accessToken: session.accessToken }) };
};

const invite = async (email) => {
    const { api } = await loginAs('owner');
    const sent = await api.post('/api/v2/sendInvitationEmail', { email, companyId, companyName: state.companyName, role: 3, designation: 0 });
    const invitation = sent.body && sent.body.data;
    if (!invitation || !invitation._id) throw new Error(`invite failed (${sent.status}): ${JSON.stringify(sent.body).slice(0, 300)}`);
    return row(invitation._id);
};

const accept = (api, invitation, fields = {}) => api.post('/api/v2/auth/invitation-accept', {
    companyId, memberId: String(invitation._id), linkId: invitation.linkId, ...fields,
});
const preview = (invitation, linkId = invitation.linkId) => anonymous.post('/api/v2/auth/invitation-preview', {
    companyId, memberId: String(invitation._id), linkId,
});

const expectUntouched = async (invitation, ...accounts) => {
    await settle();
    const after = await row(invitation._id);
    expect(after.status).toBe(invitation.status);
    expect(after.linkId).toBe(invitation.linkId);
    expect(String(after.userId || '')).toBe(String(invitation.userId || ''));
    for (const account of accounts) expect(await companiesOf(account.userId)).not.toContain(companyId);
};

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
});

afterAll(async () => {
    if (client) await client.close();
});

describe('previewing an invitation for an address that already has an account', () => {
    it('tells the holder of the link, and only them, that the address can sign in', async () => {
        const existing = await registeredAccount(freshEmail('signedin.preview'));
        const forExisting = await invite(existing.email);
        const forNewcomer = await invite(freshEmail('signedin.preview.new'));

        expect((await preview(forExisting)).body.data).toMatchObject({ email: existing.email, hasAccount: true });
        expect((await preview(forNewcomer)).body.data).toMatchObject({ hasAccount: false });

        const wrongToken = await preview(forExisting, crypto.randomBytes(32).toString('hex'));
        expect(wrongToken.body.status).toBe(false);
        expect(wrongToken.body.data).toBeUndefined();
        expect(JSON.stringify((await preview(forExisting)).body)).not.toContain(existing.userId);
    });
});

describe('accepting an invitation while signed in', () => {
    it('adds the invited account, signed in with the link token, as an active member', async () => {
        const existing = await registeredAccount(freshEmail('signedin.accept'));
        const invitation = await invite(existing.email);
        expect(String(invitation.userId)).toBe(existing.userId);

        const res = await accept(existing.api, invitation);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: true, companyId });
        const after = await row(invitation._id);
        expect(after.status).toBe(ACTIVE);
        expect(String(after.userId)).toBe(existing.userId);
        expect(after.linkId).toBeFalsy();
        expect(await companiesOf(existing.userId)).toContain(companyId);
        expect((await preview(invitation)).body.status).toBe(false);
    });

    it('accepts an invitation sent before the account existed, for the account that verified the address', async () => {
        const email = freshEmail('signedin.later');
        const invitation = await invite(email);
        expect(String(invitation.userId || '')).toBe('');
        const existing = await registeredAccount(email);

        const res = await accept(existing.api, invitation);

        expect(res.body).toMatchObject({ status: true, companyId });
        expect((await row(invitation._id)).status).toBe(ACTIVE);
        expect(await companiesOf(existing.userId)).toContain(companyId);
    });

    it('refuses another signed-in account and changes nothing', async () => {
        const intended = await registeredAccount(freshEmail('signedin.intended'));
        const other = await registeredAccount(freshEmail('signedin.other'));
        const invitation = await invite(intended.email);

        const res = await accept(other.api, invitation);

        expect(res.status).toBe(403);
        expect(res.body.status).toBe(false);
        await expectUntouched(invitation, intended, other);
    });

    it('refuses the other account even when the invitation was sent before any account existed', async () => {
        const email = freshEmail('signedin.byemail');
        const invitation = await invite(email);
        await registeredAccount(email);
        const other = await registeredAccount(freshEmail('signedin.byemail.other'));

        const res = await accept(other.api, invitation);

        expect(res.body.status).toBe(false);
        await expectUntouched(invitation, other);
    });

    it.each([
        ['withdrawn', { status: 3, isDelete: true }],
        ['cancelled', { status: 3 }],
        ['deactivated', { status: 0 }],
        ['already active', { status: ACTIVE }],
    ])('refuses an invitation that is %s', async (_label, adminChange) => {
        const existing = await registeredAccount(freshEmail('signedin.notpending'));
        const sent = await invite(existing.email);
        await companyUsers().updateOne({ _id: sent._id }, { $set: adminChange });
        const invitation = await row(sent._id);

        const res = await accept(existing.api, invitation);

        expect(res.status).toBe(403);
        expect(res.body.status).toBe(false);
        await expectUntouched(invitation, existing);
    });

    it.each([
        ['no token', () => ({ linkId: undefined })],
        ['an empty token', () => ({ linkId: '' })],
        ['a wrong token', () => ({ linkId: crypto.randomBytes(32).toString('hex') })],
    ])('refuses %s', async (_label, fields) => {
        const existing = await registeredAccount(freshEmail('signedin.token'));
        const invitation = await invite(existing.email);

        const res = await accept(existing.api, invitation, fields());

        expect(res.status).toBe(403);
        expect(res.body.status).toBe(false);
        await expectUntouched(invitation, existing);
    });

    it('refuses another invitation\'s token', async () => {
        const existing = await registeredAccount(freshEmail('signedin.swap'));
        const invitation = await invite(existing.email);
        const another = await invite(freshEmail('signedin.swap.other'));

        const res = await accept(existing.api, invitation, { linkId: another.linkId });

        expect(res.body.status).toBe(false);
        await expectUntouched(invitation, existing);
        await expectUntouched(another);
    });

    it('refuses the invitation id under another company', async () => {
        const existing = await registeredAccount(freshEmail('signedin.company'));
        const invitation = await invite(existing.email);

        const res = await accept(existing.api, invitation, { companyId: new ObjectId().toString() });

        expect(res.body.status).toBe(false);
        await expectUntouched(invitation, existing);
    });

    it('takes the account from the session, never from the request', async () => {
        const intended = await registeredAccount(freshEmail('signedin.body'));
        const other = await registeredAccount(freshEmail('signedin.body.other'));
        const invitation = await invite(intended.email);

        const res = await accept(other.api, invitation, { userId: intended.userId, uid: intended.userId });

        expect(res.body.status).toBe(false);
        await expectUntouched(invitation, intended, other);
    });

    it('needs a session', async () => {
        const existing = await registeredAccount(freshEmail('signedin.anon'));
        const invitation = await invite(existing.email);

        const res = await accept(anonymous, invitation, { userId: existing.userId });

        expect(res.status).toBe(401);
        await expectUntouched(invitation, existing);
    });

    it('answers every refusal alike, so it tells a signed-in caller nothing about the invitation', async () => {
        const intended = await registeredAccount(freshEmail('signedin.alike'));
        const other = await registeredAccount(freshEmail('signedin.alike.other'));
        const invitation = await invite(intended.email);
        const withdrawn = await invite(freshEmail('signedin.alike.withdrawn'));
        await companyUsers().updateOne({ _id: withdrawn._id }, { $set: { status: 3, isDelete: true } });

        const wrongAccount = await accept(other.api, invitation);
        const wrongToken = await accept(intended.api, invitation, { linkId: crypto.randomBytes(32).toString('hex') });
        const unknownRow = await accept(intended.api, { _id: new ObjectId(), linkId: invitation.linkId });
        const notPending = await accept(other.api, withdrawn);

        for (const res of [wrongToken, unknownRow, notPending]) {
            expect(res.status).toBe(wrongAccount.status);
            expect(res.body).toEqual(wrongAccount.body);
        }
        expect(JSON.stringify(wrongAccount.body)).not.toMatch(/@/);
    });

    it('accepts once: a second try with the same link is refused', async () => {
        const existing = await registeredAccount(freshEmail('signedin.twice'));
        const invitation = await invite(existing.email);
        expect((await accept(existing.api, invitation)).body.status).toBe(true);

        const again = await accept(existing.api, invitation);

        expect(again.body.status).toBe(false);
        expect((await row(invitation._id)).status).toBe(ACTIVE);
    });
});

describe('the invitation stays pending for everyone it was not sent to', () => {
    it('is still pending after refusals, and the invited account can then accept', async () => {
        const intended = await registeredAccount(freshEmail('signedin.after'));
        const other = await registeredAccount(freshEmail('signedin.after.other'));
        const invitation = await invite(intended.email);
        await accept(other.api, invitation);
        await accept(intended.api, invitation, { linkId: 'x' });

        expect((await row(invitation._id)).status).toBe(PENDING);
        expect((await accept(intended.api, invitation)).body.status).toBe(true);
    });
});

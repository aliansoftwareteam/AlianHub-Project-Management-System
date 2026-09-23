const crypto = require('node:crypto');
const { MongoClient, ObjectId } = require('mongodb');
const { createApiClient } = require('../../e2e/support/api');
const { PASSWORD, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { resolveMongoUrl } = require('../../e2e/support/env');

const state = readState();
const anonymous = createApiClient({ baseURL: state.baseURL });

let client;
const users = () => client.db('global').collection('users');
const userAuth = () => client.db('global').collection('userAuth');

const freshEmail = (label) => `${label}.${uniqueSuffix()}@e2e.alianhub.test`;
const missingId = () => crypto.randomBytes(12).toString('hex');

/* Compared as the bytes on the wire, so no field, order or status can tell the cases apart. */
const rawPost = async (path, body) => {
    const res = await fetch(new URL(path, state.baseURL), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
    });
    return `${res.status} ${await res.text()}`;
};

const signUp = async (email) => {
    const created = await anonymous.post('/api/v2/createUser', { firstName: 'Mia', lastName: 'Mailer', email, password: PASSWORD });
    expect(created.body.status).toBe(true);
    return String(created.body.statusText._id);
};

const verificationTokenOf = async (id) => {
    const account = await users().findOne({ _id: new ObjectId(id) }, { projection: { verificationToken: 1 } });
    return account && account.verificationToken;
};

/* The answer does not wait for the mail, so the new link lands just after it. */
const eventually = async (read, accept) => {
    const deadline = Date.now() + 5000;
    let value = await read();
    while (!accept(value) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        value = await read();
    }
    return value;
};

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
});

afterAll(async () => {
    if (client) await client.close();
});

describe('resending the verification email', () => {
    it('gives the same answer for a missing, a verified and an unverified account', async () => {
        const verifiedId = await signUp(freshEmail('mail.verified'));
        await users().updateOne({ _id: new ObjectId(verifiedId) }, { $set: { isEmailVerified: true, verificationToken: 'kept' } });
        const unverifiedId = await signUp(freshEmail('mail.unverified'));
        await users().updateOne({ _id: new ObjectId(unverifiedId) }, { $set: { verificationToken: 'old' } });

        const missing = await rawPost('/api/v2/sendVerificationEmail', { uid: missingId() });
        const verified = await rawPost('/api/v2/sendVerificationEmail', { uid: verifiedId });
        const unverified = await rawPost('/api/v2/sendVerificationEmail', { uid: unverifiedId });

        expect(verified).toBe(missing);
        expect(unverified).toBe(missing);
        expect(missing.startsWith('200 ')).toBe(true);
    });

    it('issues a new link only to an account that is still unverified', async () => {
        const verifiedId = await signUp(freshEmail('mail.verified.token'));
        await users().updateOne({ _id: new ObjectId(verifiedId) }, { $set: { isEmailVerified: true, verificationToken: 'kept' } });
        const unverifiedId = await signUp(freshEmail('mail.unverified.token'));
        await users().updateOne({ _id: new ObjectId(unverifiedId) }, { $set: { verificationToken: 'old' } });

        await rawPost('/api/v2/sendVerificationEmail', { uid: verifiedId });
        await rawPost('/api/v2/sendVerificationEmail', { uid: unverifiedId });

        expect(await eventually(() => verificationTokenOf(unverifiedId), (token) => token !== 'old')).not.toBe('old');
        expect(await verificationTokenOf(verifiedId)).toBe('kept');
    });
});

describe('asking for a password reset', () => {
    it('gives the same answer whether or not the address has an account', async () => {
        const email = freshEmail('mail.reset');
        await signUp(email);

        const missing = await rawPost('/api/v2/auth/forgot-password', { email: freshEmail('mail.reset.none') });
        const existing = await rawPost('/api/v2/auth/forgot-password', { email });

        expect(existing).toBe(missing);
        expect(missing.startsWith('200 ')).toBe(true);
    });

    it('stores a reset token only for the account that exists', async () => {
        const email = freshEmail('mail.reset.token');
        await signUp(email);
        await userAuth().updateOne({ email }, { $set: { token: '' } });

        await rawPost('/api/v2/auth/forgot-password', { email });

        const auth = await eventually(() => userAuth().findOne({ email }, { projection: { token: 1 } }), (row) => Boolean(row && row.token));
        expect(auth.token).toBeTruthy();
    });

    it('treats an address that is not a string as no account', async () => {
        const missing = await rawPost('/api/v2/auth/forgot-password', { email: freshEmail('mail.reset.none') });
        const operator = await rawPost('/api/v2/auth/forgot-password', { email: { $ne: null } });
        expect(operator).toBe(missing);
    });

    it('gives the same answer on the older reset endpoint', async () => {
        const email = freshEmail('mail.reset.legacy');
        await signUp(email);
        const body = (address) => ({ email: address, token: 'client-token', tokenId: 'client-token-id' });

        const missing = await rawPost('/api/v2/sendForgotPasswordEmail', body(freshEmail('mail.reset.legacy.none')));
        const existing = await rawPost('/api/v2/sendForgotPasswordEmail', body(email));

        expect(existing).toBe(missing);
        expect(missing.startsWith('200 ')).toBe(true);
    });
});

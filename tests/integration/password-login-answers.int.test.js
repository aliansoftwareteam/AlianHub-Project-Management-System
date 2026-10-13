const bcrypt = require('bcrypt');
const { MongoClient } = require('mongodb');
const { createApiClient } = require('../../e2e/support/api');
const { PASSWORD, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { resolveMongoUrl } = require('../../e2e/support/env');

const state = readState();
const anonymous = createApiClient({ baseURL: state.baseURL });
const WRONG = 'Wrong-Passw0rd!';

let client;
const userAuth = () => client.db('global').collection('userAuth');
const freshEmail = (label) => `${label}.${uniqueSuffix()}@e2e.alianhub.test`;

/* Compared as the bytes on the wire, so no field, order or status can tell the cases apart. */
const rawLogin = async (email, password) => {
    const started = process.hrtime.bigint();
    const res = await fetch(new URL('/api/v2/auth/login', state.baseURL), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ email, password, isLoginType: 'frontend' }),
    });
    const wire = `${res.status} ${await res.text()}`;
    return { wire, ms: Number(process.hrtime.bigint() - started) / 1e6 };
};

const signUp = async (email, password = PASSWORD) => {
    const created = await anonymous.post('/api/v2/createUser', { firstName: 'Lou', lastName: 'Login', email, password });
    expect(created.body.status).toBe(true);
    return String(created.body.statusText._id);
};

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
});

afterAll(async () => {
    if (client) await client.close();
});

describe('password sign-in failures', () => {
    it('answer an unknown email and a wrong password with the same bytes', async () => {
        const unknown = await rawLogin(freshEmail('login.none'), WRONG);
        const wrong = await rawLogin(state.users.member.email, WRONG);
        expect(wrong.wire).toBe(unknown.wire);
        expect(unknown.wire.startsWith('400 ')).toBe(true);
    });

    it('answer a blocked account, an account with no password and an unverified account the same way', async () => {
        const blocked = freshEmail('login.blocked');
        await signUp(blocked);
        await userAuth().updateOne({ email: blocked }, { $set: { isBlocked: true } });
        const passwordless = freshEmail('login.nopassword');
        await signUp(passwordless);
        await userAuth().updateOne({ email: passwordless }, { $unset: { passwordHash: '' } });
        const unverified = freshEmail('login.unverified');
        await signUp(unverified);

        const unknown = (await rawLogin(freshEmail('login.none'), WRONG)).wire;
        expect((await rawLogin(blocked, WRONG)).wire).toBe(unknown);
        expect((await rawLogin(passwordless, WRONG)).wire).toBe(unknown);
        expect((await rawLogin(unverified, WRONG)).wire).toBe(unknown);
    });

    it('treat an email that is not a string as an unknown email', async () => {
        const unknown = (await rawLogin(freshEmail('login.none'), WRONG)).wire;
        expect((await rawLogin({ $ne: null }, WRONG)).wire).toBe(unknown);
    });

    it('take about as long for an unknown email as for a wrong password', async () => {
        const unknown = [];
        const wrong = [];
        for (let i = 0; i < 5; i += 1) {
            unknown.push((await rawLogin(freshEmail('login.timing'), WRONG)).ms);
            wrong.push((await rawLogin(state.users.member.email, WRONG)).ms);
        }
        expect(median(unknown)).toBeGreaterThan(median(wrong) * 0.5);
    });
});

describe('password sign-in with the right password', () => {
    it('still opens a session', async () => {
        const res = await anonymous.post('/api/v2/auth/login', { email: state.users.member.email, password: PASSWORD, isLoginType: 'frontend' });
        expect(res.status).toBe(200);
        expect(res.body.accessToken).toBeTruthy();
    });

    it('says a blocked account is blocked', async () => {
        const email = freshEmail('login.blocked.right');
        await signUp(email);
        await userAuth().updateOne({ email }, { $set: { isBlocked: true } });
        const res = await anonymous.post('/api/v2/auth/login', { email, password: PASSWORD, isLoginType: 'frontend' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/blocked/i);
    });
});

describe('password sign-in reads every character of the password', () => {
    const SHARED_START = `Aa1!${'x'.repeat(56)}`;
    const CHOSEN = `${SHARED_START}-the-chosen-tail`;
    const SAME_START = `${SHARED_START}-another-tail`;
    const refused = async () => (await rawLogin(freshEmail('login.none'), WRONG)).wire;
    const storedFormat = async (email) => {
        for (let i = 0; i < 100; i += 1) {
            const row = await userAuth().findOne({ email });
            if (row.passwordHashVersion === 2) return row;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return userAuth().findOne({ email });
    };

    it('signs in only with the whole password chosen at sign-up', async () => {
        const email = freshEmail('login.long');
        await signUp(email, CHOSEN);

        expect((await userAuth().findOne({ email })).passwordHashVersion).toBe(2);
        expect((await rawLogin(email, SAME_START)).wire).toBe(await refused());
        expect((await rawLogin(email, CHOSEN)).wire).not.toBe(await refused());
    });

    it('still signs in with a password stored before the format version, and stores it in the current one', async () => {
        const email = freshEmail('login.legacy');
        const id = await signUp(email);
        const legacyHash = await bcrypt.hash(id + CHOSEN, 4);
        await userAuth().updateOne({ email }, { $set: { passwordHash: legacyHash }, $unset: { passwordHashVersion: '' } });

        expect((await rawLogin(email, WRONG)).wire).toBe(await refused());
        expect((await userAuth().findOne({ email })).passwordHash).toBe(legacyHash);

        expect((await rawLogin(email, CHOSEN)).wire).not.toBe(await refused());
        const upgraded = await storedFormat(email);
        expect(upgraded.passwordHashVersion).toBe(2);
        expect(upgraded.passwordHash).not.toBe(legacyHash);
        expect((await rawLogin(email, SAME_START)).wire).toBe(await refused());
        expect((await rawLogin(email, CHOSEN)).wire).not.toBe(await refused());
    });
});

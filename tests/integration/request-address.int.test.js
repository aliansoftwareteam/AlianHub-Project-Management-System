const path = require('node:path');
const { MongoClient } = require('mongodb');
const { createApiClient } = require('../../e2e/support/api');
const { STATE_DIR, resolveMongoUrl } = require('../../e2e/support/env');
const { emailFor, readState } = require('../../e2e/support/fixtures');
const { startServer } = require('../../e2e/support/server');

const state = readState();
const BOOT_TIMEOUT_MS = 180000;
const FORWARDED = '203.0.113.7';
const LOOPBACK = /^(::ffff:)?127\.0\.0\.1$|^::1$/;

let client;

const signInThrough = async (server, forwardedFor) => {
    const anon = createApiClient({ baseURL: server.baseURL });
    const res = await anon.post('/api/v2/auth/login', { email: emailFor('member'), password: state.password }, { headers: { 'x-forwarded-for': forwardedFor } });
    expect(res.status).toBe(200);
    const { jti } = JSON.parse(Buffer.from(String(res.body.refreshToken).split('.')[1], 'base64url').toString('utf8'));
    const session = await client.db('global').collection('sessions').findOne({ refreshTokenJti: jti }, { projection: { ip: 1 } });
    return session.ip;
};

const withServer = (trustProxy, body) => () => {
    let server;
    beforeAll(async () => {
        server = await startServer({
            mongoUrl: resolveMongoUrl(),
            logFile: path.join(STATE_DIR, `request-address-${trustProxy}-server.log`),
            env: { TRUST_PROXY: trustProxy },
        });
    }, BOOT_TIMEOUT_MS);
    afterAll(async () => {
        if (server) await server.stop();
    }, BOOT_TIMEOUT_MS);
    body(() => server);
};

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
});

afterAll(async () => {
    if (client) await client.close();
});

describe('with TRUST_PROXY off', withServer('false', (server) => {
    it('stores the connecting address on the session, whatever x-forwarded-for claims', async () => {
        expect(await signInThrough(server(), FORWARDED)).toMatch(LOOPBACK);
    });
}));

describe('with TRUST_PROXY=1', withServer('1', (server) => {
    it('stores the address the proxy appended, not one the client prepended', async () => {
        expect(await signInThrough(server(), `198.51.100.1, ${FORWARDED}`)).toBe(FORWARDED);
    });
}));

require('./fixtures/mcpFlagsOff');
const crypto = require('crypto');
const verified = require('./fixtures/verifiedRequest');
const mockDb = require('./fixtures/fakeMongo').create();

const CLIENT_ID = `${crypto.randomBytes(6).toString('hex')}.apps.fake.test`;
const CLIENT_SECRET = crypto.randomBytes(18).toString('base64url');
const mockProvider = require('./fixtures/fakeProvider').create({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
const mockRoles = {};

jest.mock('../Modules/Connectors/registry', () => {
    const actual = jest.requireActual('../Modules/Connectors/registry');
    return { ...actual.createRegistry({ dir: require('path').join(__dirname, 'fixtures', 'connectors') }), createRegistry: actual.createRegistry };
});
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, uid) => {
        const roles = mockRoles[companyId] || {};
        return uid in roles ? roles[uid] : null;
    }),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
    evaluatePermission: jest.fn(async () => true), isWritable: (p) => p === true || p === 1 || p === 2, isReadable: (p) => p !== null && p !== undefined && p !== 0,
}));
jest.mock('../Modules/Agents/engine/safeFetch', () => ({
    ...jest.requireActual('../Modules/Agents/engine/safeFetch'),
    safeFetch: jest.fn((url, opts) => mockProvider.fetch(url, opts)),
}));

const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const store = require('../Config/secrets');
const ctrl = require('../Modules/Connectors/connectorsController');
const { resolveConnection, CODE } = require('../Modules/Connectors/resolveConnection');
const connection = require('../Modules/Connectors/connection');
const { endMemberConnections } = require('../Modules/Agents/connectors/memberDeparted');
const { REVOKE_URL } = require('./fixtures/fakeProvider');

const C = '6f0000000000000000000c01';
const MEMBER = '6f0000000000000000000a03';
const COLLEAGUE = '6f0000000000000000000a05';
const SESSION = { [MEMBER]: '6e0000000000000000000003', [COLLEAGUE]: '6e0000000000000000000005' };
const P = 'fake';
const T = SCHEMA_TYPE.CONNECTOR_CONNECTIONS;
const WEB = 'http://localhost:8080';
const HOUR = 60 * 60 * 1000;
const ENV = {
    CONNECTORS: P, SECRETS_STORE: 'true', SECRETS_KEY: crypto.randomBytes(24).toString('hex'), AGENT_TAINT_ROUTING: 'on',
    CONNECTOR_FAKE_CLIENT_ID: CLIENT_ID, CONNECTOR_FAKE_CLIENT_SECRET: CLIENT_SECRET,
    APIURL: 'http://localhost:4000/', WEBURL: WEB, CORS_ORIGINS: '', JWT_SECRET: crypto.randomBytes(24).toString('hex'),
};

const rows = (type) => mockDb.store[type] || [];
const rowOf = (uid) => rows(T).find((r) => r.userId === uid && r.deletedStatusKey !== 1);
const audits = (action) => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((a) => a.action === action);
const settle = () => new Promise((resolve) => setImmediate(resolve));
const sealed = () => rows(SCHEMA_TYPE.SECRETS).filter((s) => s.ciphertext);
const revokeCalls = () => mockProvider.calls.filter((c) => c.url === REVOKE_URL);
const grantOf = (refreshToken) => mockProvider.grants.get(refreshToken);
const refreshTokens = () => mockProvider.issued.filter((token) => token.startsWith('rt-'));

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.json = r.send;
    r.set = () => r;
    return r;
};
const call = async (handler, uid, { body = {}, params = {} } = {}) => {
    const r = res();
    await handler(verified({ headers: { companyid: C, origin: WEB }, uid, sessionId: SESSION[uid], body, params, query: {} }), r);
    return r;
};
const consentAs = async (uid, who = {}) => {
    const started = await call(ctrl.connect, uid, { params: { provider: P } });
    expect(started.code).toBe(200);
    return mockProvider.consent(started.body.data.url, who);
};
const completeAs = (uid, { state, code }) => call(ctrl.complete, uid, { params: { provider: P }, body: { state, code } });
const connectAs = async (uid, who = {}) => {
    const out = await completeAs(uid, await consentAs(uid, who));
    expect(out.code).toBe(200);
    return out;
};
const tokenFor = (uid) => resolveConnection({ companyId: C, userId: uid, provider: P });
const expire = (uid) => { rowOf(uid).accessExpiresAt = new Date(Date.now() - 1000); };

/* Runs `interloper` once, after the provider has answered the first call that `when` picks and before the caller
 * sees the answer: the shape of a disconnect or removal that lands while an exchange or refresh is in flight. */
const during = (when, interloper) => {
    let pending = true;
    safeFetch.mockImplementation(async (url, opts) => {
        const answer = await mockProvider.fetch(url, opts);
        const form = Object.fromEntries(new URLSearchParams((opts && opts.data) || ''));
        if (pending && when(String(url), form)) {
            pending = false;
            await interloper();
        }
        return answer;
    });
};
const exchangeCall = (url, form) => form.grant_type === 'authorization_code';
const refreshCall = (url, form) => form.grant_type === 'refresh_token';

let clock = null;
const later = (ms) => {
    const at = Date.now() + ms;
    if (clock) clock.mockRestore();
    clock = jest.spyOn(Date, 'now').mockReturnValue(at);
};

const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

beforeEach(() => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    mockProvider.reset();
    Object.keys(mockRoles).forEach((k) => delete mockRoles[k]);
    mockRoles[C] = { [MEMBER]: 3, [COLLEAGUE]: 3 };
});

afterEach(() => {
    safeFetch.mockImplementation((url, opts) => mockProvider.fetch(url, opts));
    if (clock) { clock.mockRestore(); clock = null; }
});

afterAll(() => {
    Object.keys(ENV).forEach((k) => { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; });
});

describe('a revoke the provider refused is retried by the sweep (067 criterion 2)', () => {
    it('a removal made while the provider was down is revoked by the next sweep once it is back', async () => {
        await connectAs(MEMBER);
        const [refresh] = refreshTokens();
        delete mockRoles[C][MEMBER];
        mockProvider.answers.revoke = { status: 503, body: 'unavailable' };
        expect(await endMemberConnections(C, MEMBER)).toBe(1);
        await settle();
        expect(rowOf(MEMBER)).toBeUndefined();
        expect(grantOf(refresh).revoked).toBe(false);
        expect(audits('connector.revoke')).toEqual([expect.objectContaining({ meta: expect.objectContaining({ by: 'member_removed', provider: 'failed', retry: true }) })]);

        delete mockProvider.answers.revoke;
        mockProvider.calls.length = 0;
        // Not due yet: the sweep leaves a just-failed revoke for a later pass.
        await connection.sweepCompany(C);
        expect(revokeCalls()).toHaveLength(0);

        later(2 * HOUR);
        await connection.sweepCompany(C);
        await settle();
        expect(revokeCalls()).toHaveLength(1);
        expect(revokeCalls()[0].form).toEqual({ token: refresh });
        expect(grantOf(refresh).revoked).toBe(true);
        expect(sealed()).toHaveLength(0);
        expect(audits('connector.revoke').map((a) => a.meta.provider)).toEqual(['failed', 'revoked']);
        expect(rows(T).every((r) => r.revokeRetry === undefined)).toBe(true);

        const settled = JSON.stringify(mockDb.store);
        later(48 * HOUR);
        await connection.sweepCompany(C);
        expect(revokeCalls()).toHaveLength(1);
        expect(JSON.stringify(mockDb.store)).toBe(settled);
    });

    it('keeps only the refresh token for the retry, on a closed row no lookup returns', async () => {
        await connectAs(MEMBER);
        const { access, refresh } = rowOf(MEMBER).handles;
        mockProvider.answers.revoke = { status: 503, body: 'unavailable' };
        await connection.disconnect({ companyId: C, userId: MEMBER, provider: P, actor: { id: MEMBER } });
        expect(await store.resolve({ companyId: C, handle: access })).toBeNull();
        expect(sealed().map((s) => s.handle)).toEqual([refresh]);
        expect(rowOf(MEMBER)).toBeUndefined();
        await expect(tokenFor(MEMBER)).rejects.toMatchObject({ code: CODE.NOT_CONNECTED });
        expect(await connection.describe(C, MEMBER, P)).toMatchObject({ connected: false, connectionId: null });

        // The person is still a member: the retry is about the grant, not the seat.
        delete mockProvider.answers.revoke;
        later(2 * HOUR);
        await connection.sweepCompany(C);
        expect(grantOf(refreshTokens()[0]).revoked).toBe(true);
        expect(sealed()).toHaveLength(0);
    });

    it('gives up after the last attempt, clears the token and audits it', async () => {
        await connectAs(MEMBER);
        mockProvider.answers.revoke = { status: 503, body: 'unavailable' };
        await connection.disconnect({ companyId: C, userId: MEMBER, provider: P, actor: { id: MEMBER } });
        for (let pass = 1; pass < connection.MAX_REVOKE_ATTEMPTS; pass += 1) {
            later(2 * HOUR);
            // eslint-disable-next-line no-await-in-loop
            await connection.sweepCompany(C);
            expect(sealed()).toHaveLength(pass === connection.MAX_REVOKE_ATTEMPTS - 1 ? 0 : 1);
        }
        await settle();
        expect(revokeCalls()).toHaveLength(connection.MAX_REVOKE_ATTEMPTS);
        expect(audits('connector.revoke').map((a) => a.meta.provider).slice(-1)).toEqual(['gave_up']);
        later(2 * HOUR);
        await connection.sweepCompany(C);
        expect(revokeCalls()).toHaveLength(connection.MAX_REVOKE_ATTEMPTS);
    });

    it('a reconnect to another account audits the revoke of the earlier one, and a failed one is retried', async () => {
        await connectAs(MEMBER, { accountId: 'acc-1' });
        await connectAs(MEMBER, { accountId: 'acc-2' });
        await settle();
        expect(audits('connector.revoke')).toEqual([expect.objectContaining({ meta: expect.objectContaining({ by: 'reconnected', provider: 'revoked' }) })]);

        mockProvider.answers.revoke = { status: 503, body: 'unavailable' };
        await connectAs(MEMBER, { accountId: 'acc-3' });
        await settle();
        expect(audits('connector.revoke').map((a) => a.meta.provider)).toEqual(['revoked', 'failed']);
        const second = refreshTokens()[1];
        expect(grantOf(second).revoked).toBe(false);
        expect(rowOf(MEMBER).account.id).toBe('acc-3');
        expect(await (await tokenFor(MEMBER)).getAccessToken()).toBe(await store.resolve({ companyId: C, handle: rowOf(MEMBER).handles.access }));

        delete mockProvider.answers.revoke;
        later(2 * HOUR);
        await connection.sweepCompany(C);
        expect(grantOf(second).revoked).toBe(true);
        expect(grantOf(refreshTokens()[2]).revoked).toBe(false);
        expect(rowOf(MEMBER)).toMatchObject({ status: 'connected' });
        expect(sealed().map((s) => s.handle).sort()).toEqual(Object.values(rowOf(MEMBER).handles).sort());
    });
});

describe('a disconnect or removal that lands while tokens are being written', () => {
    it('a removal during the code exchange leaves no token, revokes the new grant and does not answer connected', async () => {
        const consent = await consentAs(MEMBER);
        during(exchangeCall, async () => {
            delete mockRoles[C][MEMBER];
            await endMemberConnections(C, MEMBER);
        });
        const out = await completeAs(MEMBER, consent);
        await settle();
        expect(out.code).toBe(409);
        expect(out.body.code).toBe('connection_ended');
        expect(rowOf(MEMBER)).toBeUndefined();
        expect(sealed()).toHaveLength(0);
        expect(grantOf(refreshTokens()[0]).revoked).toBe(true);
        expect(audits('connector.connect')).toHaveLength(0);
        expect(audits('connector.revoke')).toEqual([expect.objectContaining({ meta: expect.objectContaining({ by: 'late_grant', provider: 'revoked' }) })]);
    });

    it('a disconnect during a reconnect\'s exchange revokes both grants and keeps no token', async () => {
        await connectAs(MEMBER);
        const consent = await consentAs(MEMBER);
        during(exchangeCall, () => connection.disconnect({ companyId: C, userId: MEMBER, provider: P, actor: { id: MEMBER } }));
        const out = await completeAs(MEMBER, consent);
        expect(out.code).toBe(409);
        expect(rowOf(MEMBER)).toBeUndefined();
        expect(sealed()).toHaveLength(0);
        expect(refreshTokens()).toHaveLength(2);
        refreshTokens().forEach((token) => expect(grantOf(token).revoked).toBe(true));
    });

    it('a disconnect during a refresh keeps no token and hands none out', async () => {
        await connectAs(MEMBER);
        const conn = await tokenFor(MEMBER);
        expire(MEMBER);
        during(refreshCall, () => connection.disconnect({ companyId: C, userId: MEMBER, provider: P, actor: { id: MEMBER } }));
        await expect(conn.getAccessToken()).rejects.toMatchObject({ code: CODE.NOT_CONNECTED });
        expect(rowOf(MEMBER)).toBeUndefined();
        expect(sealed()).toHaveLength(0);
        expect(grantOf(refreshTokens()[0]).revoked).toBe(true);
    });

    it('a token written between the disconnect\'s read and its close is ended with the rest', async () => {
        await connectAs(MEMBER);
        const real = mockDb.crud.getMockImplementation();
        let pending = true;
        mockDb.crud.mockImplementation(async (companyId, query, method) => {
            const change = method === 'findOneAndUpdate' && query.type === T && query.data[1] && query.data[1].$set;
            if (pending && change && change.deletedStatusKey === 1) {
                pending = false;
                // A refresh makes a new handle only when the old one was already retired.
                await store.retire({ companyId: C, handle: rowOf(MEMBER).handles.access, actor: { id: MEMBER } });
                const written = await store.create({ companyId: C, name: 'a refreshed access token', kind: 'connector', value: 'at-late', actor: { id: MEMBER } });
                rowOf(MEMBER).handles = { ...rowOf(MEMBER).handles, access: written.handle };
            }
            return real(companyId, query, method);
        });
        try {
            await connection.disconnect({ companyId: C, userId: MEMBER, provider: P, actor: { id: MEMBER } });
        } finally { mockDb.crud.mockImplementation(real); }
        expect(rowOf(MEMBER)).toBeUndefined();
        expect(sealed()).toHaveLength(0);
        expect(grantOf(refreshTokens()[0]).revoked).toBe(true);
    });
});

describe('a departed member is ended even where the provider is no longer offered', () => {
    it('the removal hook ends a connection to a provider CONNECTORS no longer names', async () => {
        await connectAs(MEMBER);
        process.env.CONNECTORS = 'slack';
        delete mockRoles[C][MEMBER];
        expect(await endMemberConnections(C, MEMBER)).toBe(1);
        expect(grantOf(refreshTokens()[0]).revoked).toBe(true);
        expect(sealed()).toHaveLength(0);
        expect(rowOf(MEMBER)).toBeUndefined();
    });

    it('the sweep ends a departed member\'s connection while no provider is named at all', async () => {
        await connectAs(MEMBER);
        await connectAs(COLLEAGUE);
        process.env.CONNECTORS = '';
        delete mockRoles[C][MEMBER];
        expect(await connection.sweepCompany(C)).toBe(1);
        expect(grantOf(refreshTokens()[0]).revoked).toBe(true);
        expect(rowOf(MEMBER)).toBeUndefined();
        expect(rowOf(COLLEAGUE)).toMatchObject({ status: 'connected' });
    });

    it('a provider whose app is gone is still ended, and revoked since its revoke needs no app', async () => {
        await connectAs(MEMBER);
        delete process.env.CONNECTOR_FAKE_CLIENT_ID;
        delete process.env.CONNECTOR_FAKE_CLIENT_SECRET;
        expect(await connection.isOffered(C, P)).toBe(false);
        delete mockRoles[C][MEMBER];
        expect(await endMemberConnections(C, MEMBER)).toBe(1);
        expect(grantOf(refreshTokens()[0]).revoked).toBe(true);
        expect(sealed()).toHaveLength(0);
    });
});

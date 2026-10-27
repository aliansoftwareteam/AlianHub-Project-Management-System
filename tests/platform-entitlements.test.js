const crypto = require('crypto');

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));

const INSTANCE = 'ins_01jd3kabcdefghijklmnopqr';
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const other = crypto.generateKeyPairSync('ed25519');
const rawPublic = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');

const hostingMode = require('../Config/hostingMode');
const logger = require('../Config/loggerConfig');
const platformState = require('../Modules/Platform/platformState');
const { verifyEntitlementsToken } = require('../Modules/Platform/entitlementsToken');
const entitlements = require('../Modules/Platform/entitlements');

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const sign = (payload, { key = privateKey, header = { alg: 'EdDSA', kid: 'plat-2026-10' } } = {}) => {
    const signingInput = `${b64(header)}.${b64(payload)}`;
    return `${signingInput}.${crypto.sign(null, Buffer.from(signingInput), key).toString('base64url')}`;
};
const payloadOf = (version, extra = {}) => ({
    instanceId: INSTANCE, version, issuedAt: new Date().toISOString(), plan: 'pro', lifecycle: 'active',
    limits: { seats: 60, guests: null, workspaces: 3, storageBytes: 161061273600, maxFileBytes: 104857600, emailsPerDay: 2000 },
    features: { timeTracker: { enabled: true, seats: 20 }, customDomain: false, ownSmtp: false, sso: false },
    graceUntil: null, portalUrl: `https://account.alianhub.com/i/${INSTANCE}`, ...extra,
});

const saved = { HOSTING_MODE: process.env.HOSTING_MODE, INSTANCE_ID: process.env.INSTANCE_ID, PLATFORM_PUBLIC_KEY: process.env.PLATFORM_PUBLIC_KEY, PLATFORM_URL: process.env.PLATFORM_URL, PLATFORM_API_KEY: process.env.PLATFORM_API_KEY };
let store;

beforeAll(() => {
    Object.assign(process.env, { HOSTING_MODE: 'managed', INSTANCE_ID: INSTANCE, PLATFORM_PUBLIC_KEY: rawPublic, PLATFORM_URL: 'https://account.example.test', PLATFORM_API_KEY: 'p'.repeat(48) });
    hostingMode._resetForTests();
});

afterAll(() => {
    Object.entries(saved).forEach(([key, value]) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; });
    hostingMode._resetForTests();
    platformState._useStoreForTests(null);
});

beforeEach(() => {
    store = platformState.memoryStore();
    platformState._useStoreForTests(store);
    entitlements._resetForTests();
    jest.clearAllMocks();
});

describe('verifying the signed plan', () => {
    it('accepts a token the platform signed for this instance', () => {
        const verdict = verifyEntitlementsToken(sign(payloadOf(7)));
        expect(verdict).toMatchObject({ ok: true, header: { alg: 'EdDSA', kid: 'plat-2026-10' }, payload: { version: 7, plan: 'pro' } });
    });

    it('refuses a token signed with another key', () => {
        expect(verifyEntitlementsToken(sign(payloadOf(7), { key: other.privateKey }))).toMatchObject({ ok: false, code: 'bad_signature' });
    });

    it('refuses a payload changed after signing', () => {
        const [header, , signature] = sign(payloadOf(7)).split('.');
        const raised = `${header}.${b64({ ...payloadOf(7), limits: { seats: 9999 } })}.${signature}`;
        expect(verifyEntitlementsToken(raised)).toMatchObject({ ok: false, code: 'bad_signature' });
    });

    it('refuses a token for another instance', () => {
        expect(verifyEntitlementsToken(sign(payloadOf(7, { instanceId: 'ins_01jd3kzzzzzzzzzzzzzzzzzz' })))).toMatchObject({ ok: false, code: 'wrong_instance' });
    });

    it('refuses a token issued more than five minutes ahead, and allows small clock skew', () => {
        const ahead = (ms) => sign(payloadOf(7, { issuedAt: new Date(Date.now() + ms).toISOString() }));
        expect(verifyEntitlementsToken(ahead(6 * 60 * 1000))).toMatchObject({ ok: false, code: 'future_issued' });
        expect(verifyEntitlementsToken(ahead(60 * 1000))).toMatchObject({ ok: true });
    });

    it('refuses another algorithm and anything that is not a compact JWS', () => {
        expect(verifyEntitlementsToken(sign(payloadOf(7), { header: { alg: 'none' } }))).toMatchObject({ ok: false, code: 'bad_alg' });
        expect(verifyEntitlementsToken('not.a.jws!')).toMatchObject({ ok: false, code: 'malformed' });
        expect(verifyEntitlementsToken('')).toMatchObject({ ok: false, code: 'malformed' });
    });
});

describe('storing the plan', () => {
    it('runs on the Starter defaults before the first push, never unlimited', () => {
        const current = entitlements.currentEntitlements();
        expect(current).toMatchObject({ plan: 'starter', version: 0, instanceId: INSTANCE, limits: { seats: 10, guests: 5, workspaces: 1, storageBytes: 20 * 1024 ** 3 } });
        expect(Object.values(current.limits).every((limit) => Number.isFinite(limit))).toBe(true);
    });

    it('applies a newer version and ignores an older or equal one', async () => {
        expect(await entitlements.acceptEntitlementsToken(sign(payloadOf(7)))).toEqual({ applied: true, version: 7 });
        expect(await entitlements.acceptEntitlementsToken(sign(payloadOf(7)))).toEqual({ applied: false, version: 7 });
        expect(await entitlements.acceptEntitlementsToken(sign(payloadOf(5, { plan: 'business' })))).toEqual({ applied: false, version: 7 });
        expect(entitlements.currentEntitlements()).toMatchObject({ version: 7, plan: 'pro' });
        expect(store.docs.get('entitlements')).toMatchObject({ version: 7, kid: 'plat-2026-10', source: 'push', payload: { plan: 'pro' } });
        expect(await entitlements.acceptEntitlementsToken(sign(payloadOf(8, { plan: 'business' })))).toEqual({ applied: true, version: 8 });
        expect(entitlements.currentEntitlements().plan).toBe('business');
    });

    it('refuses a forged token with a 400 and keeps what it had', async () => {
        await entitlements.acceptEntitlementsToken(sign(payloadOf(3)));
        await expect(entitlements.acceptEntitlementsToken(sign(payloadOf(9), { key: other.privateKey }))).rejects.toMatchObject({ statusCode: 400, code: 'bad_signature' });
        expect(entitlements.storedVersion()).toBe(3);
    });

    it('stores the plan and says so once while nothing enforces it yet', async () => {
        await entitlements.acceptEntitlementsToken(sign(payloadOf(1)));
        await entitlements.acceptEntitlementsToken(sign(payloadOf(2)));
        expect(logger.info.mock.calls.filter(([line]) => /nothing enforces them yet/.test(line))).toHaveLength(1);
    });
});

describe('the pull fallback', () => {
    const answer = (status, body) => jest.fn(async () => ({ ok: status < 400, status, json: async () => body }));

    it('asks the platform with the instance key and applies a newer plan', async () => {
        const fetchImpl = answer(200, { token: sign(payloadOf(4)) });
        expect(await entitlements.pullEntitlements({ fetchImpl })).toEqual({ ok: true, applied: true, version: 4 });
        const [url, options] = fetchImpl.mock.calls[0];
        expect(url).toBe(`https://account.example.test/api/v1/instances/${INSTANCE}/entitlements`);
        expect(options.headers['x-platform-key']).toBe('p'.repeat(48));
    });

    it('keeps the stored plan when the platform cannot be reached', async () => {
        await entitlements.acceptEntitlementsToken(sign(payloadOf(6)));
        const fetchImpl = jest.fn(async () => { throw new Error('getaddrinfo ENOTFOUND account.example.test'); });
        expect(await entitlements.pullEntitlements({ fetchImpl })).toMatchObject({ ok: false, version: 6 });
        expect(entitlements.currentEntitlements()).toMatchObject({ version: 6, plan: 'pro' });
        expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/keeping version 6/));
    });

    it('keeps the stored plan on an error answer or a forged token', async () => {
        await entitlements.acceptEntitlementsToken(sign(payloadOf(6)));
        expect(await entitlements.pullEntitlements({ fetchImpl: answer(503, {}) })).toMatchObject({ ok: false, reason: 'HTTP 503' });
        expect(await entitlements.pullEntitlements({ fetchImpl: answer(200, { token: sign(payloadOf(9), { key: other.privateKey }) }) })).toMatchObject({ ok: false });
        expect(entitlements.storedVersion()).toBe(6);
    });

    it('keeps the Starter defaults when nothing was ever stored and the platform is down', async () => {
        await entitlements.pullEntitlements({ fetchImpl: answer(500, {}) });
        expect(entitlements.currentEntitlements()).toMatchObject({ plan: 'starter', version: 0 });
    });

    it('does nothing on a self-hosted instance', async () => {
        process.env.HOSTING_MODE = 'self';
        hostingMode._resetForTests();
        const fetchImpl = answer(200, {});
        try {
            expect(await entitlements.pullEntitlements({ fetchImpl })).toEqual({ ok: false, reason: 'self-hosted' });
            expect(fetchImpl).not.toHaveBeenCalled();
        } finally {
            process.env.HOSTING_MODE = 'managed';
            hostingMode._resetForTests();
        }
    });
});

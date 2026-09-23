const mockDb = require('./fixtures/fakeMongo').create();
const mockHooks = { afterInstanceRead: null, afterTokenRead: null, instanceReadError: false };

/* fakeMongo has no upsert; the grace start is written with one when the instance
 * settings document does not exist yet, so that single case is emulated here. */
const mockCrud = async (companyId, query, method) => {
    if (method === 'findOne' && query.type === 'instance_settings' && mockHooks.instanceReadError) {
        mockDb.calls.push({ companyId, type: query.type, method, data: query.data, failed: true });
        throw new Error('connection reset');
    }
    if (method === 'findOne' && query.type === 'apiTokens' && mockHooks.afterTokenRead) {
        const row = await mockDb.crud(companyId, query, method);
        const hook = mockHooks.afterTokenRead;
        mockHooks.afterTokenRead = null;
        hook();
        return row;
    }
    if (method === 'findOne' && query.type === 'instance_settings' && mockHooks.afterInstanceRead) {
        const row = await mockDb.crud(companyId, query, method);
        const hook = mockHooks.afterInstanceRead;
        mockHooks.afterInstanceRead = null;
        hook();
        return row;
    }
    const [filter, update, options] = Array.isArray(query.data) ? query.data : [];
    if (method === 'findOneAndUpdate' && options && options.upsert) {
        const rows = mockDb.store[query.type] || [];
        const { matches } = require('./fixtures/fakeMongo');
        if (!rows.some((row) => matches(row, filter))) {
            if (rows.some((row) => String(row._id) === String(filter._id))) {
                throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
            }
            mockDb.seed(query.type, { _id: filter._id, ...(update.$set || {}) });
        }
    }
    return mockDb.crud(companyId, query, method);
};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockCrud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const T0 = Date.UTC(2026, 8, 17, 9, 0, 0);
const USER_ID = '6f0000000000000000000a01';
const COMPANY = '6f0000000000000000000c01';
const TOKENS = 'apiTokens';
const INSTANCE = 'instance_settings';

let rules;
let ctrl;
let jwt;
let instanceSettings;

/* A fresh module registry is a fresh process: nothing memoised, an empty cache. */
const boot = () => {
    jest.resetModules();
    rules = require('../Modules/ApiTokens/helpers/apiTokenRules');
    ctrl = require('../Modules/ApiTokens/controller');
    jwt = require('../Config/jwt');
    instanceSettings = require('../Config/instanceSettings');
};

const clock = (ms) => jest.setSystemTime(ms);
const strict = (on) => {
    if (on) process.env.API_TOKEN_STRICT = 'true';
    else delete process.env.API_TOKEN_STRICT;
};

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.done = new Promise((resolve) => { res.finish = resolve; });
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; res.finish(body); return res; };
    res.json = res.send;
    res.on = () => res;
    return res;
};

const call = async (handler, req = {}) => {
    const res = response();
    await handler({ headers: { companyid: COMPANY }, body: {}, params: {}, uid: USER_ID, ...req }, res);
    return res;
};

const throughJwt = (raw, method = 'GET') => new Promise((resolve) => {
    const req = { method, originalUrl: '/api/v2/tasks', headers: { authorization: `Bearer ${raw}`, companyid: COMPANY }, body: {} };
    const res = response();
    res.done.then((body) => resolve({ passed: false, status: res.statusCode, body }));
    jwt.verifyJWTTokenV2(req, res, () => resolve({ passed: true, req }));
});

const seedToken = (over = {}) => {
    const raw = rules.generateToken();
    const doc = mockDb.seed(TOKENS, {
        name: 'Nightly export', tokenHash: rules.hashToken(raw), prefix: rules.tokenPrefixOf(raw),
        scopes: [], userId: USER_ID, active: true, createdAt: new Date(T0 - 400 * DAY), ...over,
    });
    return { raw, doc };
};

const tokens = () => mockDb.store[TOKENS] || [];
const instanceDoc = () => (mockDb.store[INSTANCE] || []).find((row) => row._id === 'instance');
const lastUsedWrites = () => mockDb.calls.filter((c) => c.type === TOKENS && c.method === 'updateOne');
const instanceWrites = () => mockDb.calls.filter((c) => c.type === INSTANCE && c.method === 'findOneAndUpdate');

beforeEach(() => {
    mockHooks.afterInstanceRead = null;
    mockHooks.afterTokenRead = null;
    mockHooks.instanceReadError = false;
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] });
    clock(T0);
    Object.keys(mockDb.store).forEach((key) => { delete mockDb.store[key]; });
    mockDb.calls.length = 0;
    strict(false);
    mockDb.seed('users', { _id: USER_ID, AssignCompany: COMPANY });
    mockDb.seed('company_users', { userId: USER_ID, status: 2, isDelete: false });
    boot();
});

afterEach(() => {
    strict(false);
    delete process.env.NODEMAILER_HOST;
    jest.useRealTimers();
});

describe('API_TOKEN_STRICT off keeps today\'s behaviour', () => {
    it('creates a token with neither an expiry nor scopes', async () => {
        const res = await call(ctrl.createToken, { body: { name: 'CI' } });
        expect(res.body.status).toBe(true);
        expect(tokens()[0].scopes).toEqual([]);
        expect(tokens()[0].expiresAt).toBeUndefined();
    });

    it('accepts a legacy token with no expiry and empty scopes for reads and writes, however old strict mode is', async () => {
        mockDb.seed(INSTANCE, { _id: 'instance', values: {}, apiTokenStrictSince: new Date(T0 - 100 * DAY) });
        const { raw } = seedToken();
        expect(await ctrl.verifyToken(COMPANY, raw)).toBeTruthy();
        expect((await throughJwt(raw, 'GET')).passed).toBe(true);
        expect((await throughJwt(raw, 'POST')).passed).toBe(true);
    });

    it('records no grace start and reports empty scopes as they are stored', async () => {
        const { raw } = seedToken();
        const passed = await throughJwt(raw);
        const who = await call(ctrl.whoami, { apiToken: passed.req.apiToken });
        expect(who.body.data.scopes).toEqual([]);
        await call(ctrl.listTokens);
        expect(instanceWrites()).toHaveLength(0);
    });

    it('lists tokens with strict mode reported off and no grace state', async () => {
        seedToken();
        const res = await call(ctrl.listTokens);
        expect(res.body.policy).toMatchObject({ strict: false, strictSince: null });
        expect(res.body.data[0]).toMatchObject({ graceState: null, graceEndsAt: null });
    });

    it('still validates creation input as before', () => {
        expect(rules.validateCreateInput({ name: 'T' }).valid).toBe(true);
        expect(rules.validateCreateInput({ name: 'T', scopes: [] }).valid).toBe(true);
    });
});

describe('API_TOKEN_STRICT on refuses new tokens without an expiry or scopes', () => {
    beforeEach(() => strict(true));

    it('refuses a token without an expiry', async () => {
        const res = await call(ctrl.createToken, { body: { name: 'CI', scopes: ['read'] } });
        expect(res.body.status).toBe(false);
        expect(res.body.statusText).toMatch(/expir/i);
        expect(tokens()).toHaveLength(0);
    });

    it('refuses a token with no scopes, given or empty', async () => {
        for (const body of [{ name: 'CI', expiresInDays: 30 }, { name: 'CI', expiresInDays: 30, scopes: [] }]) {
            const res = await call(ctrl.createToken, { body });
            expect(res.body.status).toBe(false);
            expect(res.body.statusText).toMatch(/scope/i);
        }
        expect(tokens()).toHaveLength(0);
    });

    it('creates a token that has both', async () => {
        const res = await call(ctrl.createToken, { body: { name: 'CI', scopes: ['read'], expiresInDays: 30 } });
        expect(res.body.status).toBe(true);
        expect(tokens()[0].scopes).toEqual(['read']);
        expect(new Date(tokens()[0].expiresAt).getTime()).toBe(T0 + 30 * DAY);
    });

    it('refuses an agent token without an expiry, and one asked for with empty scopes', async () => {
        const noExpiry = await call(ctrl.createMcpToken, { body: { name: 'Laptop' } });
        expect(noExpiry.body.status).toBe(false);
        expect(noExpiry.body.statusText).toMatch(/expir/i);
        const noScopes = await call(ctrl.createMcpToken, { body: { name: 'Laptop', expiresInDays: 7, scopes: [] } });
        expect(noScopes.body.status).toBe(false);
        expect(noScopes.body.statusText).toMatch(/scope/i);
        expect(tokens()).toHaveLength(0);
    });

    it('refuses an update that leaves a token without an expiry, but always lets it be revoked', async () => {
        const { doc } = seedToken();
        const rename = await call(ctrl.updateToken, { params: { id: doc._id }, body: { name: 'Renamed' } });
        expect(rename.body.status).toBe(false);
        expect(rename.body.statusText).toMatch(/expir/i);
        expect(tokens()[0].name).toBe('Nightly export');

        const revoke = await call(ctrl.updateToken, { params: { id: doc._id }, body: { active: false } });
        expect(revoke.body.status).toBe(true);
        expect(tokens()[0].active).toBe(false);
    });

    it('validates creation input the same way for the issuing script', () => {
        expect(rules.validateCreateInput({ name: 'T', scopes: ['read'] }).valid).toBe(false);
        expect(rules.validateCreateInput({ name: 'T', expiresInDays: 30 }).valid).toBe(false);
        expect(rules.validateCreateInput({ name: 'T', scopes: ['write'], expiresInDays: 30 }).valid).toBe(true);
    });
});

describe('a legacy token with no expiry gets 30 days from when strict mode was first seen', () => {
    beforeEach(() => strict(true));

    it('works inside the 30 days and is refused from the 30th day, whatever the token\'s age', async () => {
        const { raw } = seedToken({ scopes: ['read', 'write'] });
        expect(await ctrl.verifyToken(COMPANY, raw)).toBeTruthy();

        clock(T0 + 30 * DAY - MINUTE);
        expect(await ctrl.verifyToken(COMPANY, raw)).toBeTruthy();
        expect((await throughJwt(raw)).passed).toBe(true);

        clock(T0 + 30 * DAY);
        expect(await ctrl.verifyToken(COMPANY, raw)).toBeNull();
        const refused = await throughJwt(raw);
        expect(refused).toMatchObject({ passed: false, status: 401 });
        expect(refused.body.error).toMatch(/no expiry/i);
        expect(refused.body.error).toContain('2026-10-17');
    });

    it('gives a token made after strict mode began 30 days from its own creation', async () => {
        const { raw } = seedToken();
        await ctrl.verifyToken(COMPANY, raw);

        const late = seedToken({ name: 'Made later', createdAt: new Date(T0 + 20 * DAY) });
        clock(T0 + 45 * DAY);
        expect(await ctrl.verifyToken(COMPANY, raw)).toBeNull();
        expect(await ctrl.verifyToken(COMPANY, late.raw)).toBeTruthy();

        clock(T0 + 50 * DAY);
        expect(await ctrl.verifyToken(COMPANY, late.raw)).toBeNull();
        const refused = await throughJwt(late.raw);
        expect(refused.body.error).toContain('2026-11-06');
    });

    it('turned off and back on after more than 30 days: old tokens stay stopped, tokens made while it was off get 30 days from creation', async () => {
        const { raw: old } = seedToken({ name: 'Old' });
        await ctrl.verifyToken(COMPANY, old);

        strict(false);
        boot();
        clock(T0 + 10 * DAY);
        const offEarly = seedToken({ name: 'Made while off, early', createdAt: new Date(T0 + 10 * DAY) });
        clock(T0 + 25 * DAY);
        const offLate = seedToken({ name: 'Made while off, late', createdAt: new Date(T0 + 25 * DAY) });
        expect(await ctrl.verifyToken(COMPANY, old)).toBeTruthy();

        clock(T0 + 45 * DAY);
        strict(true);
        boot();
        expect(await ctrl.verifyToken(COMPANY, old)).toBeNull();
        expect(await ctrl.verifyToken(COMPANY, offEarly.raw)).toBeNull();
        expect(await ctrl.verifyToken(COMPANY, offLate.raw)).toBeTruthy();

        const list = await call(ctrl.listTokens);
        const row = (name) => list.body.data.find((t) => t.name === name);
        expect(row('Old')).toMatchObject({ graceState: 'stopped' });
        expect(new Date(row('Old').graceEndsAt).getTime()).toBe(T0 + 30 * DAY);
        expect(row('Made while off, early')).toMatchObject({ graceState: 'stopped' });
        expect(new Date(row('Made while off, early').graceEndsAt).getTime()).toBe(T0 + 40 * DAY);
        expect(row('Made while off, late')).toMatchObject({ graceState: 'grace' });
        expect(new Date(row('Made while off, late').graceEndsAt).getTime()).toBe(T0 + 55 * DAY);
    });

    it('does not touch a token that has an expiry', async () => {
        const { raw } = seedToken({ scopes: ['read'], expiresAt: new Date(T0 + 200 * DAY) });
        await ctrl.verifyToken(COMPANY, raw);
        clock(T0 + 90 * DAY);
        expect(await ctrl.verifyToken(COMPANY, raw)).toBeTruthy();
    });

    it('shows the owner which tokens need replacing and by when, then which stopped', async () => {
        seedToken({ name: 'Legacy' });
        seedToken({ name: 'Current', scopes: ['read'], expiresAt: new Date(T0 + 60 * DAY) });

        const during = await call(ctrl.listTokens);
        expect(during.body.policy).toMatchObject({ strict: true, graceDays: 30 });
        expect(new Date(during.body.policy.strictSince).getTime()).toBe(T0);
        const legacy = during.body.data.find((t) => t.name === 'Legacy');
        expect(legacy.graceState).toBe('grace');
        expect(new Date(legacy.graceEndsAt).getTime()).toBe(T0 + 30 * DAY);
        expect(during.body.data.find((t) => t.name === 'Current')).toMatchObject({ graceState: null, graceEndsAt: null });

        clock(T0 + 31 * DAY);
        const after = await call(ctrl.listTokens);
        expect(after.body.data.find((t) => t.name === 'Legacy').graceState).toBe('stopped');
    });
});

describe('empty scopes under strict mode read as read and write, which is all full access ever granted', () => {
    beforeEach(() => strict(true));

    it('grants exactly the two scopes the catalogue has', () => {
        expect(rules.effectiveScopes({ scopes: [] })).toEqual(['read', 'write']);
        expect(rules.hasScope({ scopes: [] }, 'read')).toBe(true);
        expect(rules.hasScope({ scopes: [] }, 'write')).toBe(true);
        expect(rules.hasScope({ scopes: [] }, 'admin')).toBe(false);
        expect(rules.hasScope({ scopes: ['read'] }, 'write')).toBe(false);
    });

    it('lets a legacy empty-scope token read and write inside the grace, and whoami names both scopes', async () => {
        const { raw } = seedToken();
        const read = await throughJwt(raw, 'GET');
        expect(read.passed).toBe(true);
        expect((await throughJwt(raw, 'PATCH')).passed).toBe(true);
        const who = await call(ctrl.whoami, { apiToken: read.req.apiToken });
        expect(who.body.data.scopes).toEqual(['read', 'write']);
    });

    it('still refuses a write from a read-only token', async () => {
        const { raw } = seedToken({ scopes: ['read'], expiresAt: new Date(T0 + DAY) });
        expect(await throughJwt(raw, 'POST')).toMatchObject({ passed: false, status: 403 });
    });
});

describe('lastUsedAt', () => {
    const storedLastUsed = () => tokens()[0].lastUsedAt;

    it('is written on use and then at most once per five minutes, across restarts', async () => {
        const { raw } = seedToken({ scopes: ['read'], expiresAt: new Date(T0 + DAY) });
        await ctrl.verifyToken(COMPANY, raw);
        await Promise.resolve();
        expect(lastUsedWrites()).toHaveLength(1);
        expect(new Date(storedLastUsed()).getTime()).toBe(T0);

        clock(T0 + 2 * MINUTE);
        await ctrl.verifyToken(COMPANY, raw);
        boot();
        clock(T0 + 4 * MINUTE);
        await ctrl.verifyToken(COMPANY, raw);
        expect(lastUsedWrites()).toHaveLength(1);

        clock(T0 + 5 * MINUTE + 1);
        await ctrl.verifyToken(COMPANY, raw);
        expect(lastUsedWrites()).toHaveLength(2);
        expect(new Date(storedLastUsed()).getTime()).toBe(T0 + 5 * MINUTE + 1);
    });

    it('does not overwrite a value another server refreshed after this one read the token', async () => {
        const { raw, doc } = seedToken({ scopes: ['read'], expiresAt: new Date(T0 + DAY), lastUsedAt: new Date(T0 - 10 * MINUTE) });
        const stored = tokens().find((row) => row._id === doc._id);
        mockHooks.afterTokenRead = () => { stored.lastUsedAt = new Date(T0 - 4 * MINUTE); };
        await ctrl.verifyToken(COMPANY, raw);
        expect(lastUsedWrites()).toHaveLength(1);
        expect(stored.lastUsedAt.getTime()).toBe(T0 - 4 * MINUTE);
    });

    it('overwrites a stored value that is exactly five minutes old', async () => {
        const { raw, doc } = seedToken({ scopes: ['read'], expiresAt: new Date(T0 + DAY), lastUsedAt: new Date(T0 - 10 * MINUTE) });
        const stored = tokens().find((row) => row._id === doc._id);
        mockHooks.afterTokenRead = () => { stored.lastUsedAt = new Date(T0 - 5 * MINUTE); };
        await ctrl.verifyToken(COMPANY, raw);
        expect(stored.lastUsedAt.getTime()).toBe(T0);
    });
});

describe('the grace start', () => {
    beforeEach(() => strict(true));

    it('is recorded once, on the instance settings document, when strict mode is first seen', async () => {
        mockDb.seed(INSTANCE, { _id: 'instance', values: {} });
        const { raw } = seedToken();
        await ctrl.verifyToken(COMPANY, raw);
        expect(new Date(instanceDoc().apiTokenStrictSince).getTime()).toBe(T0);

        boot();
        clock(T0 + 10 * DAY);
        await ctrl.verifyToken(COMPANY, raw);
        await call(ctrl.listTokens);
        expect(new Date(instanceDoc().apiTokenStrictSince).getTime()).toBe(T0);
        expect(instanceWrites()).toHaveLength(1);
    });

    it('is not reset by turning strict mode off and on again', async () => {
        const { raw } = seedToken();
        await ctrl.verifyToken(COMPANY, raw);

        strict(false);
        boot();
        clock(T0 + 40 * DAY);
        expect(await ctrl.verifyToken(COMPANY, raw)).toBeTruthy();

        strict(true);
        boot();
        expect(await ctrl.verifyToken(COMPANY, raw)).toBeNull();
        expect(new Date(instanceDoc().apiTokenStrictSince).getTime()).toBe(T0);
    });

    it('creates the instance settings document when there is none, and survives a settings save', async () => {
        expect(instanceDoc()).toBeUndefined();
        const { raw } = seedToken();
        await ctrl.verifyToken(COMPANY, raw);
        expect(new Date(instanceDoc().apiTokenStrictSince).getTime()).toBe(T0);

        await instanceSettings.saveInstanceSettings({ NODEMAILER_HOST: 'smtp.example.com' }, USER_ID);
        expect(instanceDoc().values).toMatchObject({ NODEMAILER_HOST: 'smtp.example.com' });
        expect(new Date(instanceDoc().apiTokenStrictSince).getTime()).toBe(T0);
    });

    it('returns a stored value without writing', async () => {
        mockDb.seed(INSTANCE, { _id: 'instance', values: {}, apiTokenStrictSince: new Date(T0 - 3 * DAY) });
        expect((await instanceSettings.markFirstSeen('apiTokenStrictSince', new Date(T0))).getTime()).toBe(T0 - 3 * DAY);
        expect(instanceWrites()).toHaveLength(0);
    });

    it('keeps the first value when another server writes it between the read and the write', async () => {
        const doc = mockDb.seed(INSTANCE, { _id: 'instance', values: {} });
        mockHooks.afterInstanceRead = () => { doc.apiTokenStrictSince = new Date(T0 - 3 * DAY); };
        expect((await instanceSettings.markFirstSeen('apiTokenStrictSince', new Date(T0))).getTime()).toBe(T0 - 3 * DAY);
        expect(instanceDoc().apiTokenStrictSince.getTime()).toBe(T0 - 3 * DAY);
    });
});

describe('when the grace start cannot be read', () => {
    beforeEach(() => strict(true));

    const instanceReads = () => mockDb.calls.filter((c) => c.type === INSTANCE && c.method === 'findOne');

    it('treats a token without an expiry as stopped, and still accepts one with an expiry', async () => {
        const legacy = seedToken();
        const current = seedToken({ name: 'Current', scopes: ['read'], expiresAt: new Date(T0 + DAY) });
        mockHooks.instanceReadError = true;

        expect(await ctrl.verifyToken(COMPANY, legacy.raw)).toBeNull();
        expect(await ctrl.verifyToken(COMPANY, current.raw)).toBeTruthy();
        const refused = await throughJwt(legacy.raw);
        expect(refused).toMatchObject({ passed: false, status: 401 });
        expect(refused.body.error).toMatch(/no expiry/i);
    });

    it('retries at most once per window and logs once per window', async () => {
        const legacy = seedToken();
        mockHooks.instanceReadError = true;

        for (let i = 0; i < 5; i += 1) await ctrl.verifyToken(COMPANY, legacy.raw);
        clock(T0 + 20 * 1000);
        await ctrl.verifyToken(COMPANY, legacy.raw);
        expect(instanceReads()).toHaveLength(1);
        expect(require('../Config/loggerConfig').error).toHaveBeenCalledTimes(1);

        clock(T0 + 61 * 1000);
        mockHooks.instanceReadError = false;
        expect(await ctrl.verifyToken(COMPANY, legacy.raw)).toBeTruthy();
        expect(instanceReads().length).toBeGreaterThan(1);
    });

    it('keeps using a start it already read', async () => {
        const legacy = seedToken();
        expect(await ctrl.verifyToken(COMPANY, legacy.raw)).toBeTruthy();
        mockHooks.instanceReadError = true;
        clock(T0 + 10 * DAY);
        expect(await ctrl.verifyToken(COMPANY, legacy.raw)).toBeTruthy();
    });
});

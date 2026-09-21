const { create } = require('./fixtures/fakeMongo');

const mockDbs = {};
const mockDbFor = (companyId) => (mockDbs[companyId] = mockDbs[companyId] || create());
const mockCrud = (companyId, query, method) => mockDbFor(String(companyId)).crud(companyId, query, method);

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockCrud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const T0 = Date.UTC(2026, 8, 21, 9, 0, 0);
const COMPANY = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000a01';
const MEMBER = '6f0000000000000000000a03';
const OVER_MAX = 'API_TOKEN_EXPIRY_OVER_MAX';

let rules;
let ctrl;
let jwt;
let logger;

const boot = () => {
    jest.resetModules();
    rules = require('../Modules/ApiTokens/helpers/apiTokenRules');
    ctrl = require('../Modules/ApiTokens/controller');
    jwt = require('../Config/jwt');
    logger = require('../Config/loggerConfig');
};

const clock = (ms) => jest.setSystemTime(ms);
const strict = (on) => {
    if (on) process.env.API_TOKEN_STRICT = 'true';
    else delete process.env.API_TOKEN_STRICT;
};
const maxDays = (value) => {
    if (value === undefined) delete process.env.API_TOKEN_MAX_DAYS;
    else process.env.API_TOKEN_MAX_DAYS = String(value);
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
    await handler({ headers: { companyid: COMPANY }, body: {}, params: {}, uid: OWNER, ...req }, res);
    return res;
};

const throughJwt = (raw) => new Promise((resolve) => {
    const req = { method: 'GET', originalUrl: '/api/v2/tasks', headers: { authorization: `Bearer ${raw}`, companyid: COMPANY }, body: {} };
    const res = response();
    res.done.then((body) => resolve({ passed: false, status: res.statusCode, body }));
    jwt.verifyJWTTokenV2(req, res, () => resolve({ passed: true, req }));
});

const db = () => mockDbFor(COMPANY);
const globalDb = () => mockDbFor(SCHEMA_TYPE.GOLBAL);
const tokens = () => db().store[SCHEMA_TYPE.API_TOKENS] || [];
const instanceDoc = () => (globalDb().store[SCHEMA_TYPE.INSTANCE_SETTINGS] || []).find((row) => row._id === 'instance');
const capWrites = () => globalDb().calls.filter((c) => c.type === SCHEMA_TYPE.INSTANCE_SETTINGS && c.method === 'findOneAndUpdate'
    && JSON.stringify(c.data).includes('apiTokenMaxLifetimeSince'));

const seedToken = (over = {}) => {
    const raw = rules.generateToken();
    const doc = db().seed(SCHEMA_TYPE.API_TOKENS, {
        name: 'Nightly export', tokenHash: rules.hashToken(raw), prefix: rules.tokenPrefixOf(raw),
        scopes: ['read', 'write'], userId: OWNER, active: true, createdAt: new Date(T0 - 10 * DAY), ...over,
    });
    return { raw, doc };
};

beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] });
    clock(T0);
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    strict(false);
    maxDays(undefined);
    globalDb().seed(SCHEMA_TYPE.INSTANCE_SETTINGS, { _id: 'instance', values: {}, apiTokenStrictSince: new Date(T0 - 5 * DAY) });
    globalDb().seed(SCHEMA_TYPE.USERS, { _id: OWNER, AssignCompany: COMPANY, Employee_Name: 'Olivia Owner' });
    globalDb().seed(SCHEMA_TYPE.USERS, { _id: MEMBER, AssignCompany: COMPANY, Employee_Name: 'Max Member' });
    db().seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    db().seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: 3, status: 2, isDelete: false });
    boot();
});

afterEach(() => {
    strict(false);
    maxDays(undefined);
    jest.useRealTimers();
});

describe('the maximum lifetime in days', () => {
    it('is 365 by default and can only be lowered through API_TOKEN_MAX_DAYS', () => {
        expect(rules.maxLifetimeDays()).toBe(365);
        maxDays(90);
        expect(rules.maxLifetimeDays()).toBe(90);
        maxDays(365);
        expect(rules.maxLifetimeDays()).toBe(365);
        for (const ignored of [366, 1000, 0, -5, 'abc', '12.5', '']) {
            maxDays(ignored);
            expect(rules.maxLifetimeDays()).toBe(365);
        }
    });

    it('warns at boot when API_TOKEN_MAX_DAYS is above 365 or not a whole number of days', () => {
        maxDays(400);
        boot();
        require('../Modules/ApiTokens/init').init({ get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), use: jest.fn(), all: jest.fn() });
        expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/API_TOKEN_MAX_DAYS.*400.*365/));

        maxDays(120);
        boot();
        require('../Modules/ApiTokens/init').init({ get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), use: jest.fn(), all: jest.fn() });
        expect(logger.warn).not.toHaveBeenCalledWith(expect.stringMatching(/API_TOKEN_MAX_DAYS/));
    });
});

describe('API_TOKEN_STRICT on: a new token lasts at most the maximum lifetime', () => {
    beforeEach(() => strict(true));

    it('refuses a personal token asked to last longer, with a stable code and the maximum', async () => {
        const res = await call(ctrl.createToken, { body: { name: 'CI', scopes: ['read'], expiresInDays: 366 } });
        expect(res.body).toMatchObject({ status: false, code: OVER_MAX, maxExpiryDays: 365 });
        expect(res.body.statusText).toMatch(/365/);
        expect(tokens()).toHaveLength(0);

        const ok = await call(ctrl.createToken, { body: { name: 'CI', scopes: ['read'], expiresInDays: 365 } });
        expect(ok.body.status).toBe(true);
        expect(new Date(tokens()[0].expiresAt).getTime()).toBe(T0 + 365 * DAY);
    });

    it('applies a lowered maximum to personal and agent tokens alike', async () => {
        maxDays(90);
        const personal = await call(ctrl.createToken, { body: { name: 'CI', scopes: ['read'], expiresInDays: 91 } });
        expect(personal.body).toMatchObject({ status: false, code: OVER_MAX, maxExpiryDays: 90 });
        const agent = await call(ctrl.createMcpToken, { body: { name: 'Laptop', expiresInDays: 180 } });
        expect(agent.body).toMatchObject({ status: false, code: OVER_MAX, maxExpiryDays: 90 });
        expect(tokens()).toHaveLength(0);

        const ok = await call(ctrl.createMcpToken, { body: { name: 'Laptop', expiresInDays: 90 } });
        expect(ok.body.status).toBe(true);
    });

    it('validates the same way for the issuing script', () => {
        maxDays(30);
        expect(rules.validateCreateInput({ name: 'T', scopes: ['read'], expiresInDays: 31 })).toMatchObject({ valid: false, code: OVER_MAX });
        expect(rules.validateCreateInput({ name: 'T', scopes: ['read'], expiresInDays: 30 }).valid).toBe(true);
    });

    it('offers the maximum to the screen', async () => {
        maxDays(120);
        const res = await call(ctrl.listTokens);
        expect(res.body.policy).toMatchObject({ strict: true, maxExpiryDays: 120 });
    });

    it('has no route that pushes an existing token\'s expiry out', async () => {
        const { doc } = seedToken({ expiresAt: new Date(T0 + 30 * DAY) });
        await call(ctrl.updateToken, { params: { id: doc._id }, body: { name: 'Renamed', expiresInDays: 365, expiresAt: new Date(T0 + 900 * DAY) } });
        expect(new Date(tokens()[0].expiresAt).getTime()).toBe(T0 + 30 * DAY);
    });
});

describe('API_TOKEN_STRICT off keeps beta\'s rules', () => {
    it('ignores API_TOKEN_MAX_DAYS and refuses only past 365 days, without a code', async () => {
        maxDays(30);
        const ok = await call(ctrl.createToken, { body: { name: 'CI', expiresInDays: 200 } });
        expect(ok.body.status).toBe(true);
        const refused = await call(ctrl.createToken, { body: { name: 'CI', expiresInDays: 366 } });
        expect(refused.body.status).toBe(false);
        expect(refused.body.code).toBeUndefined();
        expect(refused.body.maxExpiryDays).toBeUndefined();
    });

    it('reports a maximum of 365 and no lifetime fields on tokens', async () => {
        maxDays(30);
        seedToken({ expiresAt: new Date(T0 + 700 * DAY) });
        const res = await call(ctrl.listTokens);
        expect(res.body.policy.maxExpiryDays).toBe(365);
        expect(res.body.data[0]).not.toHaveProperty('lifetimeState');
        expect(res.body.data[0]).not.toHaveProperty('lifetimeEndsAt');
    });

    it('keeps a token whose expiry is years away working, and records no cap start', async () => {
        const { raw } = seedToken({ expiresAt: new Date(T0 + 900 * DAY) });
        clock(T0 + 400 * DAY);
        expect(await ctrl.verifyToken(COMPANY, raw)).toBeTruthy();
        expect(capWrites()).toHaveLength(0);
        expect(instanceDoc().apiTokenMaxLifetimeSince).toBeUndefined();
    });
});

describe('an existing token whose expiry is further away than the maximum', () => {
    beforeEach(() => strict(true));

    it('works until the maximum lifetime after the cap took effect, then is refused with the date', async () => {
        const { raw } = seedToken({ expiresAt: new Date(T0 + 900 * DAY) });
        expect(await ctrl.verifyToken(COMPANY, raw)).toBeTruthy();
        expect(new Date(instanceDoc().apiTokenMaxLifetimeSince).getTime()).toBe(T0);

        clock(T0 + 365 * DAY - MINUTE);
        expect(await ctrl.verifyToken(COMPANY, raw)).toBeTruthy();

        clock(T0 + 365 * DAY);
        expect(await ctrl.verifyToken(COMPANY, raw)).toBeNull();
        const refused = await throughJwt(raw);
        expect(refused).toMatchObject({ passed: false, status: 401 });
        expect(refused.body.error).toMatch(/maximum/i);
        expect(refused.body.error).toContain('2027-09-21');
    });

    it('keeps the recorded start across restarts and counts a lowered maximum from it', async () => {
        const { raw } = seedToken({ expiresAt: new Date(T0 + 200 * DAY) });
        expect(await ctrl.verifyToken(COMPANY, raw)).toBeTruthy();

        maxDays(60);
        boot();
        clock(T0 + 59 * DAY);
        expect(await ctrl.verifyToken(COMPANY, raw)).toBeTruthy();
        clock(T0 + 60 * DAY);
        expect(await ctrl.verifyToken(COMPANY, raw)).toBeNull();
        expect(new Date(instanceDoc().apiTokenMaxLifetimeSince).getTime()).toBe(T0);
        expect(capWrites()).toHaveLength(1);
    });

    it('counts from its own creation when it was made after the cap took effect', async () => {
        globalDb().store[SCHEMA_TYPE.INSTANCE_SETTINGS][0].apiTokenMaxLifetimeSince = new Date(T0 - 100 * DAY);
        maxDays(30);
        boot();
        const { raw } = seedToken({ createdAt: new Date(T0 - 10 * DAY), expiresAt: new Date(T0 + 300 * DAY) });
        clock(T0 + 20 * DAY - MINUTE);
        expect(await ctrl.verifyToken(COMPANY, raw)).toBeTruthy();
        clock(T0 + 20 * DAY);
        expect(await ctrl.verifyToken(COMPANY, raw)).toBeNull();
    });

    it('leaves a token inside the maximum alone', async () => {
        const { raw } = seedToken({ expiresAt: new Date(T0 + 300 * DAY) });
        clock(T0 + 299 * DAY);
        expect(await ctrl.verifyToken(COMPANY, raw)).toBeTruthy();
    });

    it('with the cap start unknown, stops only a token that expires further off than the maximum from now', () => {
        const old = { createdAt: new Date(T0 - 400 * DAY), expiresAt: new Date(T0 + DAY) };
        const far = { createdAt: new Date(T0 - 10 * DAY), expiresAt: new Date(T0 + 400 * DAY) };
        const at = { strict: true, maxLifetimeSince: null, now: new Date(T0) };
        expect(rules.lifetimeStanding(old, at).state).toBe('ok');
        expect(rules.lifetimeStanding(far, at).state).toBe('stopped');
    });

    it('shows its owner the date it stops, then that it stopped', async () => {
        seedToken({ name: 'Long', expiresAt: new Date(T0 + 900 * DAY) });
        seedToken({ name: 'Short', expiresAt: new Date(T0 + 30 * DAY) });
        const during = await call(ctrl.listTokens);
        const long = during.body.data.find((t) => t.name === 'Long');
        expect(long).toMatchObject({ lifetimeState: 'capped', graceState: null });
        expect(new Date(long.lifetimeEndsAt).getTime()).toBe(T0 + 365 * DAY);
        expect(during.body.data.find((t) => t.name === 'Short')).not.toHaveProperty('lifetimeState');

        clock(T0 + 366 * DAY);
        const after = await call(ctrl.listTokens);
        expect(after.body.data.find((t) => t.name === 'Long').lifetimeState).toBe('stopped');
    });
});

describe('the workspace list of tokens to replace', () => {
    beforeEach(() => strict(true));

    const ask = (uid = OWNER) => call(ctrl.listTokensNeedingExpiry, { uid, originalUrl: '/api/v2/api-tokens/needing-expiry' });

    it('lists tokens past the maximum lifetime beside tokens without an expiry, with the reason and the deadline', async () => {
        seedToken({ name: 'Legacy', createdAt: new Date(T0 - 400 * DAY) });
        seedToken({ name: 'Long', userId: MEMBER, expiresAt: new Date(T0 + 900 * DAY) });
        seedToken({ name: 'Fine', expiresAt: new Date(T0 + 300 * DAY) });
        seedToken({ name: 'Long revoked', active: false, expiresAt: new Date(T0 + 900 * DAY) });

        const res = await ask();
        expect(res.body.status).toBe(true);
        expect(res.body.data.map((t) => t.name).sort()).toEqual(['Legacy', 'Long']);
        const long = res.body.data.find((t) => t.name === 'Long');
        expect(long).toMatchObject({ reason: 'over-max-lifetime', stopped: false, owner: { id: MEMBER, name: 'Max Member' } });
        expect(new Date(long.deadline).getTime()).toBe(T0 + 365 * DAY);
        expect(new Date(long.expiresAt).getTime()).toBe(T0 + 900 * DAY);
        expect(res.body.data.find((t) => t.name === 'Legacy').reason).toBe('no-expiry');
        expect(res.body.policy).toMatchObject({ strict: true, maxExpiryDays: 365 });
        expect(JSON.stringify(res.body)).not.toMatch(/tokenHash|"prefix"|ahp_/);
    });

    it('uses a lowered maximum and marks a token stopped once its deadline passed', async () => {
        maxDays(90);
        boot();
        seedToken({ name: 'Year', expiresAt: new Date(T0 + 365 * DAY) });
        seedToken({ name: 'Quarter', expiresAt: new Date(T0 + 80 * DAY) });
        const during = await ask();
        expect(during.body.data.map((t) => t.name)).toEqual(['Year']);
        expect(new Date(during.body.data[0].deadline).getTime()).toBe(T0 + 90 * DAY);

        clock(T0 + 91 * DAY);
        const after = await ask();
        expect(after.body.data[0]).toMatchObject({ name: 'Year', stopped: true });
    });

    it('still refuses a member', async () => {
        seedToken({ name: 'Long', expiresAt: new Date(T0 + 900 * DAY) });
        expect((await ask(MEMBER)).statusCode).toBe(403);
    });
});

describe('the recorded start', () => {
    it('is a declared field on the instance settings schema, so a strict schema keeps it', () => {
        const { schema } = require('../utils/mongo-handler/schema');
        expect(schema.instanceSettings.apiTokenMaxLifetimeSince).toMatchObject({ type: Date });
    });

    it('is kept across a backup restore like the grace start', () => {
        const source = require('fs').readFileSync(require.resolve('../Modules/Instance/backups.js'), 'utf8');
        expect(source).toMatch(/FIRST_SEEN_FIELDS = \[[^\]]*maxLifetimeSince\.FIELD/);
        expect(source).toMatch(/maxLifetimeSince\.forget\(\)/);
    });
});

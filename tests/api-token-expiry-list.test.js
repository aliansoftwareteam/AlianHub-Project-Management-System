const { create } = require('./fixtures/fakeMongo');

/* One store per company id, so a token written to another company can only be read
 * through that company's header; users and instance settings live under "global". */
const mockDbs = {};
const mockDbFor = (companyId) => (mockDbs[companyId] = mockDbs[companyId] || create());
const mockCrud = (companyId, query, method) => mockDbFor(String(companyId)).crud(companyId, query, method);

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockCrud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 17, 9, 0, 0);
const SINCE = new Date(T0 - 10 * DAY);
const COMPANY = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const OWNER = '6f0000000000000000000a01';
const ADMIN = '6f0000000000000000000a02';
const MEMBER = '6f0000000000000000000a03';
const GUEST = '6f0000000000000000000a04';
const ROUTE = '/api/v2/api-tokens/needing-expiry';

let rules;
let ctrl;

const boot = () => {
    jest.resetModules();
    rules = require('../Modules/ApiTokens/helpers/apiTokenRules');
    ctrl = require('../Modules/ApiTokens/controller');
};

const strict = (on) => {
    if (on) process.env.API_TOKEN_STRICT = 'true';
    else delete process.env.API_TOKEN_STRICT;
};

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    res.json = res.send;
    return res;
};

const ask = async (uid, over = {}) => {
    const res = response();
    await ctrl.listTokensNeedingExpiry({ headers: { companyid: COMPANY }, body: {}, params: {}, originalUrl: ROUTE, uid, ...over }, res);
    return res;
};

const seat = (userId, roleType, companyId = COMPANY) =>
    mockDbFor(companyId).seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });

const person = (id, name) => mockDbFor(SCHEMA_TYPE.GOLBAL).seed(SCHEMA_TYPE.USERS, { _id: id, Employee_Name: name, Employee_Email: `${id}@example.test` });

const seedToken = (over = {}, companyId = COMPANY) => {
    const raw = rules.generateToken();
    const doc = mockDbFor(companyId).seed(SCHEMA_TYPE.API_TOKENS, {
        name: 'Nightly export', tokenHash: rules.hashToken(raw), prefix: rules.tokenPrefixOf(raw),
        scopes: [], userId: OWNER, active: true, createdAt: new Date(SINCE.getTime() - 100 * DAY), ...over,
    });
    return { raw, doc };
};

const tokenReads = (companyId = COMPANY) => mockDbFor(companyId).calls.filter((c) => c.type === SCHEMA_TYPE.API_TOKENS);

beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] });
    jest.setSystemTime(T0);
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    strict(true);
    mockDbFor(SCHEMA_TYPE.GOLBAL).seed(SCHEMA_TYPE.INSTANCE_SETTINGS, { _id: 'instance', values: {}, apiTokenStrictSince: SINCE });
    seat(OWNER, 1);
    seat(ADMIN, 2);
    seat(MEMBER, 3);
    seat(GUEST, 0);
    person(OWNER, 'Olivia Owner');
    person(ADMIN, 'Ada Admin');
    person(MEMBER, 'Max Member');
    boot();
});

afterEach(() => {
    strict(false);
    jest.useRealTimers();
});

describe('who may list the tokens that still need an expiry', () => {
    it('refuses a member with 403 and no list', async () => {
        seedToken();
        const res = await ask(MEMBER);
        expect(res.statusCode).toBe(403);
        expect(res.body.status).toBe(false);
        expect(res.body.data).toBeUndefined();
        expect(tokenReads()).toEqual([]);
    });

    it('refuses a guest and someone with no seat in the company', async () => {
        seedToken();
        expect((await ask(GUEST)).statusCode).toBe(403);
        expect((await ask('6f0000000000000000000a99')).statusCode).toBe(403);
    });

    it('refuses an API token, even the owner\'s own', async () => {
        const { doc } = seedToken();
        const res = await ask(OWNER, { apiToken: doc });
        expect(res.statusCode).toBe(403);
        expect(res.body.status).toBe(false);
        expect(tokenReads()).toEqual([]);
    });

    it('answers an admin and an owner with the same list', async () => {
        seedToken({ name: 'Legacy' });
        const admin = await ask(ADMIN);
        const owner = await ask(OWNER);
        expect(admin.statusCode).toBe(200);
        expect(admin.body.status).toBe(true);
        expect(admin.body.data.map((t) => t.name)).toEqual(['Legacy']);
        expect(owner.body.data).toEqual(admin.body.data);
    });
});

describe('what the list holds', () => {
    it('lists every active token without an expiry, whoever owns it, and nothing else', async () => {
        seedToken({ name: 'Owner legacy' });
        seedToken({ name: 'Member legacy', userId: MEMBER, kind: 'agent' });
        seedToken({ name: 'Expiring', expiresAt: new Date(T0 + 20 * DAY) });
        seedToken({ name: 'Revoked legacy', active: false });
        const res = await ask(OWNER);
        expect(res.body.data.map((t) => t.name).sort()).toEqual(['Member legacy', 'Owner legacy']);
    });

    it('never shows another company\'s tokens', async () => {
        seat(OWNER, 1, OTHER_COMPANY);
        seedToken({ name: 'Ours' });
        seedToken({ name: 'Theirs' }, OTHER_COMPANY);
        const ours = await ask(OWNER);
        expect(ours.body.data.map((t) => t.name)).toEqual(['Ours']);
        const theirs = await ask(OWNER, { headers: { companyid: OTHER_COMPANY } });
        expect(theirs.body.data.map((t) => t.name)).toEqual(['Theirs']);
        expect(tokenReads(OTHER_COMPANY).every((c) => c.companyId === OTHER_COMPANY)).toBe(true);
    });

    it('carries no token, hash or prefix anywhere in the response', async () => {
        const { raw, doc } = seedToken();
        const res = await ask(OWNER);
        const text = JSON.stringify(res.body);
        expect(text).not.toContain(raw);
        expect(text).not.toContain(doc.tokenHash);
        expect(text).not.toContain(doc.prefix);
        expect(text).not.toContain(rules.TOKEN_PREFIX);
        expect(text).not.toMatch(/tokenHash|"prefix"|scopes/);
    });

    it('names the owner and keeps the id, kind, created and last used', async () => {
        const usedAt = new Date(T0 - 3 * DAY);
        const { doc } = seedToken({ name: 'Laptop', userId: MEMBER, kind: 'agent', lastUsedAt: usedAt });
        seedToken({ name: 'Orphan', userId: '6f0000000000000000000a98' });
        const res = await ask(ADMIN);
        const laptop = res.body.data.find((t) => t.name === 'Laptop');
        expect(laptop).toMatchObject({ _id: doc._id, name: 'Laptop', kind: 'agent', owner: { id: MEMBER, name: 'Max Member' }, lastUsedAt: usedAt, createdAt: doc.createdAt });
        const orphan = res.body.data.find((t) => t.name === 'Orphan');
        expect(orphan.owner).toEqual({ id: '6f0000000000000000000a98', name: '' });
        expect(res.body.data.find((t) => t.name === 'Orphan').kind).toBe('personal');
    });

    it('computes the deadline and stopped the way token checks do, for tokens made before and after the strict start', async () => {
        const { doc: before } = seedToken({ name: 'Before', createdAt: new Date(SINCE.getTime() - 100 * DAY) });
        const { doc: after } = seedToken({ name: 'After', createdAt: new Date(SINCE.getTime() + 5 * DAY) });
        const expected = (doc, now) => rules.graceStanding(doc, { strict: true, strictSince: SINCE, now: new Date(now) });

        const inGrace = await ask(OWNER);
        const rowBefore = inGrace.body.data.find((t) => t.name === 'Before');
        const rowAfter = inGrace.body.data.find((t) => t.name === 'After');
        expect(new Date(rowBefore.deadline).getTime()).toBe(SINCE.getTime() + 30 * DAY);
        expect(new Date(rowAfter.deadline).getTime()).toBe(SINCE.getTime() + 35 * DAY);
        expect(rowBefore.stopped).toBe(false);
        expect(rowAfter.stopped).toBe(false);
        expect(new Date(rowBefore.deadline).getTime()).toBe(expected(before, T0).deadline.getTime());
        expect(new Date(rowAfter.deadline).getTime()).toBe(expected(after, T0).deadline.getTime());

        const later = SINCE.getTime() + 31 * DAY;
        jest.setSystemTime(later);
        const afterGrace = await ask(OWNER);
        expect(afterGrace.body.data.find((t) => t.name === 'Before').stopped).toBe(true);
        expect(afterGrace.body.data.find((t) => t.name === 'After').stopped).toBe(false);
        expect(expected(before, later).state).toBe('stopped');
        expect(expected(after, later).state).toBe('grace');
        expect(afterGrace.body.policy).toMatchObject({ strict: true, graceDays: 30, strictSince: SINCE });
    });

    it('sorts by deadline, the soonest first', async () => {
        seedToken({ name: 'Late', createdAt: new Date(SINCE.getTime() + 9 * DAY) });
        seedToken({ name: 'Early', createdAt: new Date(SINCE.getTime() - 50 * DAY) });
        seedToken({ name: 'Middle', createdAt: new Date(SINCE.getTime() + 2 * DAY) });
        const res = await ask(OWNER);
        expect(res.body.data.map((t) => t.name)).toEqual(['Early', 'Middle', 'Late']);
    });

    it('answers strict: false and no tokens when strict mode is off, without reading them', async () => {
        strict(false);
        boot();
        seedToken();
        const res = await ask(OWNER);
        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe(true);
        expect(res.body.data).toEqual([]);
        expect(res.body.policy).toMatchObject({ strict: false });
        expect(tokenReads()).toEqual([]);
    });

    it('still refuses a member when strict mode is off', async () => {
        strict(false);
        boot();
        expect((await ask(MEMBER)).statusCode).toBe(403);
    });
});

const crypto = require('crypto');
const { create } = require('./fixtures/fakeMongo');

/* Sprint 8 slice 9b: the workspace provider-keys routes. Owners and admins
 * manage metadata, never values; members get 403, API tokens are refused. */
const mockDbs = {};
const mockDbFor = (companyId) => (mockDbs[companyId] = mockDbs[companyId] || create());
const mockCrud = (companyId, query, method) => mockDbFor(String(companyId)).crud(companyId, query, method);

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockCrud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');

const COMPANY = '6f0000000000000000000c01';
const OTHER = '6f0000000000000000000c02';
const OWNER = '6f0000000000000000000a01';
const ADMIN = '6f0000000000000000000a02';
const MEMBER = '6f0000000000000000000a03';
const GUEST = '6f0000000000000000000a04';
const NOBODY = '6f0000000000000000000a99';
const KEY = crypto.randomBytes(24).toString('hex');
const VALUE = `sk-ws-${crypto.randomBytes(20).toString('hex')}`;
const actor = { id: OWNER, name: 'Olivia Owner' };

const ENV_KEYS = ['TENANT_PROVIDER_KEYS', 'SECRETS_STORE', 'SECRETS_KEY'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

let ctrl;
let store;

const boot = ({ tenant = true, storeOn = true, keyValid = true } = {}) => {
    if (tenant) process.env.TENANT_PROVIDER_KEYS = 'on';
    else delete process.env.TENANT_PROVIDER_KEYS;
    if (storeOn) { process.env.SECRETS_STORE = 'true'; process.env.SECRETS_KEY = keyValid ? KEY : 'short'; }
    else { delete process.env.SECRETS_STORE; delete process.env.SECRETS_KEY; }
    jest.resetModules();
    store = require('../Config/secrets');
    ctrl = require('../Modules/ProviderKeys/controller');
};

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    res.json = res.send;
    return res;
};

const ask = async (handler, uid, { body = {}, params = {}, headers = {}, ...over } = {}) => {
    const res = response();
    await handler({ headers: { companyid: COMPANY, ...headers }, body, params, query: {}, uid, ip: '10.0.0.1', ...over }, res);
    return res;
};

const seat = (userId, roleType, companyId = COMPANY) => mockDbFor(companyId).seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
const seedCompany = (companyId) => mockDbFor(dbCollections.GLOBAL).seed(dbCollections.COMPANIES, { _id: companyId, aiProviderKeys: {} });
const secretReads = (companyId = COMPANY) => mockDbFor(companyId).calls.filter((c) => c.type === SCHEMA_TYPE.SECRETS);

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    jest.clearAllMocks();
    boot();
    seat(OWNER, 1);
    seat(ADMIN, 2);
    seat(MEMBER, 3);
    seat(GUEST, 0);
    seedCompany(COMPANY);
    seedCompany(OTHER);
});

afterAll(() => {
    ENV_KEYS.forEach((key) => {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
    });
});

describe('who may manage workspace provider keys', () => {
    it('refuses a member, a guest and someone with no seat with 403 and reads nothing', async () => {
        for (const uid of [MEMBER, GUEST, NOBODY]) {
            // eslint-disable-next-line no-await-in-loop
            const res = await ask(ctrl.listProviderKeys, uid);
            expect(res.statusCode).toBe(403);
            expect(res.body.status).toBe(false);
            expect(res.body.data).toBeUndefined();
        }
        expect(secretReads()).toEqual([]);
    });

    it('refuses an API token, even the owner\'s own, on every route', async () => {
        const token = { _id: 't1', userId: OWNER, active: true };
        expect((await ask(ctrl.listProviderKeys, OWNER, { apiToken: token })).statusCode).toBe(403);
        expect((await ask(ctrl.setProviderKey, OWNER, { apiToken: token, params: { provider: 'openai' }, body: { value: VALUE } })).statusCode).toBe(403);
        expect((await ask(ctrl.clearProviderKey, OWNER, { apiToken: token, params: { provider: 'openai' } })).statusCode).toBe(403);
        expect(secretReads()).toEqual([]);
    });

    it('answers an owner and an admin the same metadata, never a value', async () => {
        const set = await ask(ctrl.setProviderKey, OWNER, { params: { provider: 'openai' }, body: { value: VALUE } });
        expect(set.statusCode).toBe(200);
        for (const uid of [OWNER, ADMIN]) {
            // eslint-disable-next-line no-await-in-loop
            const res = await ask(ctrl.listProviderKeys, uid);
            expect(res.statusCode).toBe(200);
            expect(res.body.status).toBe(true);
            expect(res.body.data.map((row) => row.provider).sort()).toEqual(['anthropic', 'deepseek', 'google', 'openai']);
            expect(JSON.stringify(res.body)).not.toContain(VALUE);
        }
        const row = (await ask(ctrl.listProviderKeys, OWNER)).body.data.find((r) => r.provider === 'openai');
        expect(row).toMatchObject({ set: true, keyId: expect.any(String) });
    });

    it('keeps one workspace invisible from another', async () => {
        await ask(ctrl.setProviderKey, OWNER, { params: { provider: 'openai' }, body: { value: VALUE } });
        seat(OWNER, 1, OTHER);
        const other = await ask(ctrl.listProviderKeys, OWNER, { headers: { companyid: OTHER } });
        expect(other.body.data.every((row) => row.set === false)).toBe(true);
    });
});

describe('setting and clearing through the routes', () => {
    it('saves, replaces and clears a key without ever returning it', async () => {
        const first = `sk-ws-${crypto.randomBytes(20).toString('hex')}`;
        const second = `sk-ws-${crypto.randomBytes(20).toString('hex')}`;
        expect((await ask(ctrl.setProviderKey, OWNER, { params: { provider: 'anthropic' }, body: { value: first } })).body.status).toBe(true);
        const replaced = await ask(ctrl.setProviderKey, ADMIN, { params: { provider: 'anthropic' }, body: { value: second } });
        expect(replaced.body.status).toBe(true);
        expect(JSON.stringify(replaced.body)).not.toContain(second);
        const cleared = await ask(ctrl.clearProviderKey, OWNER, { params: { provider: 'anthropic' } });
        expect(cleared.body).toMatchObject({ status: true, data: { provider: 'anthropic', set: false } });
        const rows = mockDbFor(COMPANY).store[SCHEMA_TYPE.SECRETS] || [];
        expect(rows).toHaveLength(1);
        expect(rows[0].revokedAt).toBeTruthy();
    });

    it('refuses unknown providers and empty values with 400', async () => {
        expect((await ask(ctrl.setProviderKey, OWNER, { params: { provider: 'nope' }, body: { value: VALUE } })).statusCode).toBe(400);
        expect((await ask(ctrl.setProviderKey, OWNER, { params: { provider: 'openai' }, body: { value: '  ' } })).statusCode).toBe(400);
        expect((await ask(ctrl.setProviderKey, OWNER, { params: { provider: 'openai' }, body: {} })).statusCode).toBe(400);
        expect((await ask(ctrl.clearProviderKey, OWNER, { params: { provider: 'nope' } })).statusCode).toBe(400);
    });
});

describe('with the flags off', () => {
    it('answers the list probe quietly and 404s the writes while tenant keys are off', async () => {
        boot({ tenant: false });
        const list = await ask(ctrl.listProviderKeys, OWNER);
        expect(list.statusCode).toBe(200);
        expect(list.body).toMatchObject({ status: false, storeOff: true });
        expect((await ask(ctrl.setProviderKey, OWNER, { params: { provider: 'openai' }, body: { value: VALUE } })).statusCode).toBe(404);
        expect((await ask(ctrl.clearProviderKey, OWNER, { params: { provider: 'openai' } })).statusCode).toBe(404);
    });

    it('answers 404 with the secrets store off and 503 with a bad key', async () => {
        boot({ storeOn: false });
        expect((await ask(ctrl.listProviderKeys, OWNER)).statusCode).toBe(404);
        boot({ keyValid: false });
        expect((await ask(ctrl.listProviderKeys, OWNER)).statusCode).toBe(503);
    });
});

const crypto = require('crypto');
const { create } = require('./fixtures/fakeMongo');

/* Sprint 11 S2: a skill_read secret names the hosts it may be sent to, set when it is created or rotated. */
const mockDbs = {};
const mockDbFor = (companyId) => (mockDbs[companyId] = mockDbs[companyId] || create());
const mockCrud = (companyId, query, method) => mockDbFor(String(companyId)).crud(companyId, query, method);

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockCrud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { secretsSchema } = require('../utils/mongo-handler/createSchema');

const COMPANY = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000a01';
const ADMIN = '6f0000000000000000000a02';
const MEMBER = '6f0000000000000000000a03';
const KEY = crypto.randomBytes(24).toString('hex');
const VALUE = `rk_${crypto.randomBytes(20).toString('hex')}`;
const actor = { id: OWNER, name: 'Olivia Owner' };

let ctrl;
let store;
let recordAudit;

const boot = ({ reads = true } = {}) => {
    process.env.SECRETS_STORE = 'true';
    process.env.SECRETS_KEY = KEY;
    if (reads) process.env.SKILL_EXTERNAL_READS = 'on'; else delete process.env.SKILL_EXTERNAL_READS;
    jest.resetModules();
    store = require('../Config/secrets');
    ctrl = require('../Modules/Secrets/controller');
    ({ recordAudit } = require('../Modules/Audit/recorder'));
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

const seat = (userId, roleType) => mockDbFor(COMPANY).seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
const rows = () => mockDbFor(COMPANY).store[SCHEMA_TYPE.SECRETS] || [];
const readSecret = (over = {}) => ({ name: 'GitHub read token', kind: 'skill_read', value: VALUE, hosts: ['api.github.com'], ...over });

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    jest.clearAllMocks();
    boot();
    seat(OWNER, 1);
    seat(ADMIN, 2);
    seat(MEMBER, 3);
});

afterAll(() => {
    delete process.env.SECRETS_STORE;
    delete process.env.SECRETS_KEY;
    delete process.env.SKILL_EXTERNAL_READS;
});

describe('the store', () => {
    it('declares the hosts and header on the strict schema', () => {
        expect(secretsSchema.path('hosts')).toBeTruthy();
        expect(secretsSchema.path('header')).toBeTruthy();
    });

    it('keeps the hosts a skill_read secret names, canonical, and shows them with its metadata', async () => {
        const made = await store.create({ companyId: COMPANY, actor, ...readSecret({ hosts: ['API.GitHub.com', 'status.example.com:8443', 'api.github.com'] }) });
        expect(made).toMatchObject({ kind: 'skill_read', hosts: ['api.github.com', 'status.example.com:8443'] });
        expect(made).not.toHaveProperty('header');
        expect(rows()[0].hosts).toEqual(['api.github.com', 'status.example.com:8443']);
        expect(await store.describe({ companyId: COMPANY, handle: made.handle })).toMatchObject({ hosts: ['api.github.com', 'status.example.com:8443'] });
    });

    it('keeps a header name when one is given', async () => {
        const made = await store.create({ companyId: COMPANY, actor, ...readSecret({ header: 'X-Api-Key' }) });
        expect(made.header).toBe('x-api-key');
    });

    it.each([
        ['no hosts', { hosts: [] }],
        ['hosts missing', { hosts: undefined }],
        ['a wildcard', { hosts: ['*.github.com'] }],
        ['a private host', { hosts: ['localhost'] }],
        ['an address', { hosts: ['10.0.0.1'] }],
        ['a scheme', { hosts: ['https://api.github.com'] }],
        ['a string instead of a list', { hosts: 'api.github.com' }],
        ['a request header that is not a credential', { header: 'Host' }],
        ['a malformed header', { header: 'X Api: Key' }],
    ])('refuses a skill_read secret with %s', async (what, over) => {
        await expect(store.create({ companyId: COMPANY, actor, ...readSecret(over) })).rejects.toMatchObject({ code: 'invalid_input' });
        expect(rows()).toHaveLength(0);
    });

    it('refuses hosts on a secret of another kind, and leaves those rows as they were', async () => {
        await expect(store.create({ companyId: COMPANY, actor, ...readSecret({ kind: 'integration' }) })).rejects.toMatchObject({ code: 'invalid_input' });
        const made = await store.create({ companyId: COMPANY, actor, name: 'X', kind: 'integration', value: VALUE });
        expect(made).not.toHaveProperty('hosts');
        expect(rows()[0]).not.toHaveProperty('hosts');
    });

    it('replaces the hosts on a rotate that names them, and keeps them on one that does not', async () => {
        const made = await store.create({ companyId: COMPANY, actor, ...readSecret() });
        const moved = await store.rotate({ companyId: COMPANY, handle: made.handle, value: VALUE, hosts: ['raw.githubusercontent.com'], actor });
        expect(moved.hosts).toEqual(['raw.githubusercontent.com']);
        const kept = await store.rotate({ companyId: COMPANY, handle: made.handle, value: VALUE, actor });
        expect(kept.hosts).toEqual(['raw.githubusercontent.com']);
        await expect(store.rotate({ companyId: COMPANY, handle: made.handle, value: VALUE, hosts: [], actor })).rejects.toMatchObject({ code: 'invalid_input' });
        expect(recordAudit.mock.calls.map(([, e]) => [e.action, e.meta.hosts])).toEqual([
            ['secret.create', ['api.github.com']],
            ['secret.rotate', ['raw.githubusercontent.com']],
            ['secret.rotate', ['raw.githubusercontent.com']],
        ]);
    });
});

describe('the routes', () => {
    it('let an owner or an admin create a skill_read secret, answering metadata only', async () => {
        for (const uid of [OWNER, ADMIN]) {
            // eslint-disable-next-line no-await-in-loop
            const res = await ask(ctrl.createSecret, uid, { body: readSecret() });
            expect(res.statusCode).toBe(201);
            expect(res.body.data).toMatchObject({ kind: 'skill_read', hosts: ['api.github.com'], createdBy: uid });
            expect(JSON.stringify(res.body)).not.toContain(VALUE);
        }
        expect(recordAudit.mock.calls.pop()[1]).toMatchObject({ action: 'secret.create', actorId: ADMIN, ip: '10.0.0.1' });
    });

    it('refuses a member and an API token', async () => {
        expect((await ask(ctrl.createSecret, MEMBER, { body: readSecret() })).statusCode).toBe(403);
        expect((await ask(ctrl.createSecret, OWNER, { body: readSecret(), apiToken: { _id: 't1' } })).statusCode).toBe(403);
        expect(rows()).toHaveLength(0);
    });

    it('creates skill_read secrets only: the other kinds are made where they are used', async () => {
        for (const kind of ['integration', 'webhook', '', undefined]) {
            // eslint-disable-next-line no-await-in-loop
            const res = await ask(ctrl.createSecret, OWNER, { body: readSecret({ kind }) });
            expect(res.statusCode).toBe(400);
        }
        expect(rows()).toHaveLength(0);
    });

    it('refuses bad hosts with 400 and never echoes the value', async () => {
        const res = await ask(ctrl.createSecret, OWNER, { body: readSecret({ hosts: ['*.github.com'] }) });
        expect(res.statusCode).toBe(400);
        expect(JSON.stringify(res.body)).not.toContain(VALUE);
    });

    it('rotates a skill_read secret with new hosts', async () => {
        const made = await store.create({ companyId: COMPANY, actor, ...readSecret() });
        const res = await ask(ctrl.rotateSecret, OWNER, { params: { handle: made.handle }, body: { value: VALUE, hosts: ['api.gitlab.com'] } });
        expect(res.statusCode).toBe(200);
        expect(res.body.data.hosts).toEqual(['api.gitlab.com']);
        expect((await ask(ctrl.rotateSecret, OWNER, { params: { handle: made.handle }, body: { value: VALUE, hosts: ['localhost'] } })).statusCode).toBe(400);
        expect(rows()[0].hosts).toEqual(['api.gitlab.com']);
    });

    it('tells the screen whether read credentials are offered', async () => {
        expect((await ask(ctrl.listSecrets, OWNER)).body.skillReads).toBe(true);
        boot({ reads: false });
        expect((await ask(ctrl.listSecrets, OWNER)).body.skillReads).toBe(false);
    });

    it('answers 404 to a create while SKILL_EXTERNAL_READS is off, and refuses hosts on a rotate', async () => {
        const made = await store.create({ companyId: COMPANY, actor, ...readSecret() });
        boot({ reads: false });
        expect((await ask(ctrl.createSecret, OWNER, { body: readSecret() })).statusCode).toBe(404);
        expect((await ask(ctrl.rotateSecret, OWNER, { params: { handle: made.handle }, body: { value: VALUE, hosts: ['api.gitlab.com'] } })).statusCode).toBe(400);
        expect(rows()).toHaveLength(1);
        expect(rows()[0].hosts).toEqual(['api.github.com']);
    });
});

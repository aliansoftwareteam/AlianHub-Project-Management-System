const { create } = require('./fixtures/fakeMongo');

/* Sprint 8 slice 9: the workspace's stored-secrets routes. Owners and admins see metadata, never a value;
 * a member gets 403, an API token is refused, and with the flag off the routes answer 404. */
const mockDbs = {};
const mockDbFor = (companyId) => (mockDbs[companyId] = mockDbs[companyId] || create());
const mockCrud = (companyId, query, method) => mockDbFor(String(companyId)).crud(companyId, query, method);

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockCrud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');

const COMPANY = '6f0000000000000000000c01';
const OTHER = '6f0000000000000000000c02';
const OWNER = '6f0000000000000000000a01';
const ADMIN = '6f0000000000000000000a02';
const MEMBER = '6f0000000000000000000a03';
const GUEST = '6f0000000000000000000a04';
const KEY = 'current-secrets-key-0123456789abcdef0123456789';
const VALUE = 'ghp_TheOnlyCopyOfThisTokenValue000000000';
const actor = { id: OWNER, name: 'Olivia Owner' };

let ctrl;
let store;
let recordAudit;

const boot = ({ on = true } = {}) => {
    if (on) { process.env.SECRETS_STORE = 'true'; process.env.SECRETS_KEY = KEY; } else { delete process.env.SECRETS_STORE; delete process.env.SECRETS_KEY; }
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

const seat = (userId, roleType, companyId = COMPANY) => mockDbFor(companyId).seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
const rows = (companyId = COMPANY) => mockDbFor(companyId).store[SCHEMA_TYPE.SECRETS] || [];
const secretReads = (companyId = COMPANY) => mockDbFor(companyId).calls.filter((c) => c.type === SCHEMA_TYPE.SECRETS);

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    jest.clearAllMocks();
    boot();
    seat(OWNER, 1);
    seat(ADMIN, 2);
    seat(MEMBER, 3);
    seat(GUEST, 0);
});

afterAll(() => {
    delete process.env.SECRETS_STORE;
    delete process.env.SECRETS_KEY;
});

describe('who may see the workspace secrets', () => {
    it('refuses a member, a guest and someone with no seat with 403 and reads nothing', async () => {
        await store.create({ companyId: COMPANY, name: 'X', kind: 'integration', value: VALUE, actor });
        mockDbFor(COMPANY).calls.length = 0;
        for (const uid of [MEMBER, GUEST, '6f0000000000000000000a99']) {
            // eslint-disable-next-line no-await-in-loop
            const res = await ask(ctrl.listSecrets, uid);
            expect(res.statusCode).toBe(403);
            expect(res.body.status).toBe(false);
            expect(res.body.data).toBeUndefined();
        }
        expect(secretReads()).toEqual([]);
    });

    it('refuses an API token, even the owner\'s own, on every route', async () => {
        const made = await store.create({ companyId: COMPANY, name: 'X', kind: 'integration', value: VALUE, actor });
        const token = { _id: 't1', userId: OWNER, active: true };
        expect((await ask(ctrl.listSecrets, OWNER, { apiToken: token })).statusCode).toBe(403);
        expect((await ask(ctrl.rotateSecret, OWNER, { apiToken: token, params: { handle: made.handle }, body: { value: 'v2' } })).statusCode).toBe(403);
        expect((await ask(ctrl.revokeSecret, OWNER, { apiToken: token, params: { handle: made.handle } })).statusCode).toBe(403);
        expect(rows()[0].revokedAt).toBeNull();
        expect(recordAudit.mock.calls.map(([, e]) => e.action)).toEqual(['secret.create']);
    });

    it('answers an admin and an owner the same metadata, never the value or the ciphertext', async () => {
        const made = await store.create({ companyId: COMPANY, name: 'GitHub: Personal access token', kind: 'integration', value: VALUE, actor });
        const owner = await ask(ctrl.listSecrets, OWNER);
        const admin = await ask(ctrl.listSecrets, ADMIN);
        expect(owner.statusCode).toBe(200);
        expect(owner.body.status).toBe(true);
        expect(owner.body.keyId).toBe(store.config().keyId);
        expect(owner.body.data).toEqual([{
            handle: made.handle, name: 'GitHub: Personal access token', kind: 'integration', keyId: made.keyId, createdBy: OWNER,
            createdAt: made.createdAt, rotatedAt: null, revokedAt: null, lastResolvedAt: null,
        }]);
        expect(admin.body.data).toEqual(owner.body.data);
        const text = JSON.stringify(owner.body);
        expect(text).not.toContain(VALUE);
        expect(text).not.toContain(rows()[0].ciphertext);
        expect(text).not.toMatch(/ciphertext|"iv"|"tag"/);
    });

    it('never shows another company\'s secrets', async () => {
        seat(OWNER, 1, OTHER);
        await store.create({ companyId: COMPANY, name: 'Ours', kind: 'integration', value: VALUE, actor });
        await store.create({ companyId: OTHER, name: 'Theirs', kind: 'integration', value: VALUE, actor });
        expect((await ask(ctrl.listSecrets, OWNER)).body.data.map((s) => s.name)).toEqual(['Ours']);
        expect((await ask(ctrl.listSecrets, OWNER, { headers: { companyid: OTHER } })).body.data.map((s) => s.name)).toEqual(['Theirs']);
    });

    it('refuses a request without a valid company header', async () => {
        const res = await ask(ctrl.listSecrets, OWNER, { headers: { companyid: 'nope' } });
        expect(res.statusCode).toBe(403);
        expect(res.body.status).toBe(false);
    });
});

describe('rotate and revoke through the routes', () => {
    it('rotates with a new value, keeps the handle, audits the owner as the actor and never echoes the value', async () => {
        const made = await store.create({ companyId: COMPANY, name: 'X', kind: 'integration', value: VALUE, actor });
        const res = await ask(ctrl.rotateSecret, ADMIN, { params: { handle: made.handle }, body: { value: 'glpat-NewValueAfterRotation0000000' } });
        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe(true);
        expect(res.body.data).toMatchObject({ handle: made.handle, rotatedAt: expect.any(Date) });
        expect(JSON.stringify(res.body)).not.toContain('glpat-NewValueAfterRotation0000000');
        expect(await store.resolve({ companyId: COMPANY, handle: made.handle })).toBe('glpat-NewValueAfterRotation0000000');
        expect(recordAudit.mock.calls.pop()[1]).toMatchObject({ action: 'secret.rotate', actorId: ADMIN, entityId: made.handle, ip: '10.0.0.1' });
    });

    it('refuses an empty or non-string value with 400 and leaves the secret alone', async () => {
        const made = await store.create({ companyId: COMPANY, name: 'X', kind: 'integration', value: VALUE, actor });
        const before = rows()[0].ciphertext;
        for (const value of ['', undefined, 12, { nested: true }, '   ']) {
            // eslint-disable-next-line no-await-in-loop
            const res = await ask(ctrl.rotateSecret, OWNER, { params: { handle: made.handle }, body: { value } });
            expect(res.statusCode).toBe(400);
        }
        expect(rows()[0].ciphertext).toBe(before);
    });

    it('revokes, then refuses a second revoke and a rotate with 409', async () => {
        const made = await store.create({ companyId: COMPANY, name: 'X', kind: 'integration', value: VALUE, actor });
        const res = await ask(ctrl.revokeSecret, OWNER, { params: { handle: made.handle } });
        expect(res.statusCode).toBe(200);
        expect(res.body.data).toMatchObject({ handle: made.handle, revokedAt: expect.any(Date) });
        expect((await ask(ctrl.revokeSecret, OWNER, { params: { handle: made.handle } })).statusCode).toBe(409);
        expect((await ask(ctrl.rotateSecret, OWNER, { params: { handle: made.handle }, body: { value: 'v2' } })).statusCode).toBe(409);
    });

    it('answers 404 for a handle from another company and for a malformed handle', async () => {
        seat(OWNER, 1, OTHER);
        const theirs = await store.create({ companyId: OTHER, name: 'Theirs', kind: 'integration', value: VALUE, actor });
        expect((await ask(ctrl.rotateSecret, OWNER, { params: { handle: theirs.handle }, body: { value: 'v2' } })).statusCode).toBe(404);
        expect((await ask(ctrl.revokeSecret, OWNER, { params: { handle: theirs.handle } })).statusCode).toBe(404);
        expect((await ask(ctrl.revokeSecret, OWNER, { params: { handle: 'not-a-handle' } })).statusCode).toBe(404);
        expect(rows(OTHER)[0].revokedAt).toBeNull();
        expect(await store.resolve({ companyId: OTHER, handle: theirs.handle })).toBe(VALUE);
    });
});

describe('with the flag off', () => {
    it('answers 404 on every route, even for the owner, and reads nothing', async () => {
        boot({ on: false });
        for (const [handler, over] of [[ctrl.listSecrets, {}], [ctrl.rotateSecret, { params: { handle: 'sec_000000000000000000000000' }, body: { value: 'v' } }], [ctrl.revokeSecret, { params: { handle: 'sec_000000000000000000000000' } }]]) {
            // eslint-disable-next-line no-await-in-loop
            const res = await ask(handler, OWNER, over);
            expect(res.statusCode).toBe(404);
            expect(res.body.status).toBe(false);
        }
        expect(secretReads()).toEqual([]);
    });

    it('still refuses a member and an API token before saying anything about the store', async () => {
        boot({ on: false });
        expect((await ask(ctrl.listSecrets, MEMBER)).statusCode).toBe(403);
        expect((await ask(ctrl.listSecrets, OWNER, { apiToken: { _id: 't1' } })).statusCode).toBe(403);
    });
});

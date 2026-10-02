const { create } = require('./fixtures/fakeMongo');

const mockDbs = {};
const mockDbFor = (companyId) => (mockDbs[companyId] = mockDbs[companyId] || create());
const mockCrud = (companyId, query, method) => mockDbFor(String(companyId)).crud(companyId, query, method);

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockCrud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 1, 9, 0, 0);
const COMPANY = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000a01';
const MEMBER = '6f0000000000000000000a03';
const OTHER_MEMBER = '6f0000000000000000000a04';
const PROJECT = '6f0000000000000000000b01';

let rules;
let ctrl;
let jwt;
let logger;
let socketEmitter;

const boot = () => {
    jest.resetModules();
    rules = require('../Modules/ApiTokens/helpers/apiTokenRules');
    ctrl = require('../Modules/ApiTokens/controller');
    jwt = require('../Config/jwt');
    logger = require('../Config/loggerConfig');
    socketEmitter = require('../event/socketEventEmitter');
};

const clock = (ms) => jest.setSystemTime(ms);
const setEnv = (name, value) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = String(value);
};
const strict = (on) => setEnv('API_TOKEN_STRICT', on ? 'true' : undefined);
const maxDays = (value) => setEnv('API_TOKEN_MAX_DAYS', value);

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
    await handler({ headers: { companyid: COMPANY }, body: {}, params: {}, uid: MEMBER, aud: COMPANY, ...req }, res);
    return res;
};

const throughJwt = (raw, { method = 'GET', url = '/api/v2/tasks' } = {}) => new Promise((resolve) => {
    const req = { method, originalUrl: url, headers: { authorization: `Bearer ${raw}`, companyid: COMPANY }, body: {} };
    const res = response();
    res.done.then((body) => resolve({ passed: false, status: res.statusCode, body }));
    jwt.verifyJWTTokenV2(req, res, () => resolve({ passed: true, req }));
});

const settle = () => new Promise((resolve) => setImmediate(resolve));

const db = () => mockDbFor(COMPANY);
const globalDb = () => mockDbFor(SCHEMA_TYPE.GOLBAL);
const tokens = () => db().store[SCHEMA_TYPE.API_TOKENS] || [];
const tokenOf = (id) => tokens().find((row) => String(row._id) === String(id));
const auditRows = () => db().store[SCHEMA_TYPE.AUDIT_LOGS] || [];

/* Everything a renew wrote or said outside its one answer: every database call and what is stored after it,
 * every log line and every socket event. The calls are read as sent, so a value a later write removed is still found. */
const everythingButTheAnswer = () => JSON.stringify([
    Object.values(mockDbs).map((one) => [one.calls.map((c) => c.data), one.store]),
    [logger.info, logger.error, logger.warn, logger.debug].map((fn) => fn.mock.calls),
    socketEmitter.emit.mock.calls,
]);

const seedToken = (over = {}) => {
    const raw = rules.generateToken();
    const doc = db().seed(SCHEMA_TYPE.API_TOKENS, {
        name: 'Nightly export', tokenHash: rules.hashToken(raw), prefix: rules.tokenPrefixOf(raw),
        scopes: ['read', 'write'], userId: MEMBER, active: true, createdAt: new Date(T0 - 27 * DAY), expiresAt: new Date(T0 + 3 * DAY), ...over,
    });
    return { raw, doc, id: String(doc._id) };
};

const renew = (id, req = {}) => call(ctrl.renewToken, { params: { id }, ...req });

beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] });
    clock(T0);
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    strict(false);
    maxDays(undefined);
    setEnv('MCP_TOOLS_MANAGE', undefined);
    globalDb().seed(SCHEMA_TYPE.INSTANCE_SETTINGS, { _id: 'instance', values: {}, apiTokenStrictSince: new Date(T0 - 5 * DAY) });
    globalDb().seed(SCHEMA_TYPE.COMPANIES, { _id: COMPANY });
    [[OWNER, 'Olivia Owner', 1], [MEMBER, 'Max Member', 3], [OTHER_MEMBER, 'Nia Member', 3]].forEach(([id, name, roleType]) => {
        globalDb().seed(SCHEMA_TYPE.USERS, { _id: id, AssignCompany: COMPANY, Employee_Name: name });
        db().seed(SCHEMA_TYPE.COMPANY_USERS, { userId: id, roleType, status: 2, isDelete: false });
    });
    boot();
});

afterEach(() => {
    strict(false);
    maxDays(undefined);
    jest.useRealTimers();
});

describe('the default lifetime of a new token', () => {
    it('is 30 days, inside a range that is still 1 to 365 days', () => {
        expect(rules.DEFAULT_EXPIRY_DAYS).toBe(30);
        expect(rules.defaultExpiryDays()).toBe(30);
        expect(rules.MIN_EXPIRY_DAYS).toBe(1);
        expect(rules.MAX_EXPIRY_DAYS).toBe(365);
        expect(rules.validateCreateInput({ name: 'T', expiresInDays: 1 }).valid).toBe(true);
        expect(rules.validateCreateInput({ name: 'T', expiresInDays: 365 }).valid).toBe(true);
        expect(rules.validateCreateInput({ name: 'T', expiresInDays: 0 }).valid).toBe(false);
        expect(rules.validateCreateInput({ name: 'T', expiresInDays: 366 }).valid).toBe(false);
    });

    it('is never longer than the maximum lifetime the instance allows', () => {
        strict(true);
        maxDays(7);
        expect(rules.defaultExpiryDays()).toBe(7);
        maxDays(90);
        expect(rules.defaultExpiryDays()).toBe(30);
    });

    it('is what the token form is told to preselect', async () => {
        const res = await call(ctrl.listTokens);
        expect(res.body.policy.defaultExpiryDays).toBe(30);
    });

    it('is given to a token the form asks for without saying how long', async () => {
        const res = await call(ctrl.createMcpToken, { body: { name: 'Laptop' } });
        expect(res.body.status).toBe(true);
        expect(new Date(tokens()[0].expiresAt).getTime()).toBe(T0 + 30 * DAY);
        expect(new Date(res.body.data.expiresAt).getTime()).toBe(T0 + 30 * DAY);
    });

    it('leaves a chosen lifetime alone', async () => {
        await call(ctrl.createMcpToken, { body: { name: 'Laptop', expiresInDays: 90 } });
        expect(new Date(tokens()[0].expiresAt).getTime()).toBe(T0 + 90 * DAY);
    });
});

describe('renewing a token', () => {
    it('keeps the name, the projects, the scopes and the grants, and gives a new secret with a fresh default lifetime', async () => {
        const agentAccount = { mode: 'personal', provider: 'claude-code', label: 'Laptop' };
        const { raw, id } = seedToken({ name: 'Laptop agent', kind: 'agent', agentAccount, projectIds: [PROJECT], grants: ['tasks:manage'], scopes: ['read', 'write'], lastUsedAt: new Date(T0 - DAY) });
        const before = { ...tokenOf(id) };

        const res = await renew(id);

        expect(res.body.status).toBe(true);
        const secret = res.body.data.token;
        expect(rules.looksLikeToken(secret)).toBe(true);
        expect(secret).not.toBe(raw);
        expect(res.body.data).toMatchObject({ _id: before._id, name: 'Laptop agent', kind: 'agent', projectIds: [PROJECT], grants: ['tasks:manage'], scopes: ['read', 'write'], active: true, prefix: rules.tokenPrefixOf(secret) });
        expect(new Date(res.body.data.expiresAt).getTime()).toBe(T0 + 30 * DAY);
        expect(res.body.data).not.toHaveProperty('tokenHash');

        expect(tokens()).toHaveLength(1);
        const after = tokenOf(id);
        expect(after).toMatchObject({ name: 'Laptop agent', kind: 'agent', agentAccount, projectIds: [PROJECT], grants: ['tasks:manage'], scopes: ['read', 'write'], userId: MEMBER, active: true });
        expect(after.createdAt).toEqual(before.createdAt);
        expect(after.tokenHash).toBe(rules.hashToken(secret));
        expect(after.tokenHash).not.toBe(before.tokenHash);
        expect(new Date(after.expiresAt).getTime()).toBe(T0 + 30 * DAY);
        expect(new Date(after.renewedAt).getTime()).toBe(T0);
    });

    it('stops the old secret at once and lets the new one in', async () => {
        const { raw, id } = seedToken();
        expect((await throughJwt(raw)).passed).toBe(true);

        const res = await renew(id);

        const refused = await throughJwt(raw);
        expect(refused).toMatchObject({ passed: false, status: 401 });
        const accepted = await throughJwt(res.body.data.token);
        expect(accepted.passed).toBe(true);
        expect(String(accepted.req.apiToken._id)).toBe(id);
    });

    it('shows the new secret once: the list never carries it, and a second renew replaces it', async () => {
        const { id } = seedToken();
        const first = (await renew(id)).body.data.token;

        const list = await call(ctrl.listTokens);
        expect(JSON.stringify(list.body)).not.toContain(first);
        expect(JSON.stringify(list.body)).not.toContain(rules.hashToken(first));

        const second = (await renew(id)).body.data.token;
        expect(second).not.toBe(first);
        expect((await throughJwt(first)).passed).toBe(false);
        expect((await throughJwt(second)).passed).toBe(true);
    });

    it('writes the secret nowhere but its one answer: no stored row, log line, audit row or socket event holds the old or the new one', async () => {
        const { raw, id } = seedToken({ name: 'Laptop agent', kind: 'agent', agentAccount: { mode: 'personal', provider: 'claude-code' } });
        Object.values(mockDbs).forEach((one) => { one.calls.length = 0; });

        const res = await renew(id);
        await settle();
        const secret = res.body.data.token;

        expect(JSON.stringify(res.body).split(secret)).toHaveLength(2);
        const written = everythingButTheAnswer();
        expect(written).not.toContain(secret);
        expect(written).not.toContain(raw);
        expect(written).not.toContain(secret.slice(rules.PREFIX_LENGTH));
        expect(written).toContain(rules.hashToken(secret));
        expect(res.body.statusText).not.toContain(secret);
    });

    it('leaves an audit row that names the token and the person, and no part of the secret', async () => {
        const { id } = seedToken({ name: 'Laptop agent' });
        const res = await renew(id);
        await settle();

        expect(auditRows()).toHaveLength(1);
        expect(auditRows()[0]).toMatchObject({ action: 'api_token.renewed', entityType: 'api_token', entityId: id, entityName: 'Laptop agent', actorId: MEMBER, actorName: 'Max Member' });
        const row = JSON.stringify(auditRows()[0]);
        expect(row).not.toContain(res.body.data.prefix);
        expect(row).not.toContain(rules.hashToken(res.body.data.token));
    });

    it('answers another member, an admin and an owner as if the token did not exist, and changes nothing', async () => {
        const { raw, id } = seedToken();
        const stored = JSON.stringify(tokenOf(id));

        for (const uid of [OTHER_MEMBER, OWNER]) {
            const res = await renew(id, { uid });
            expect(res.body).toEqual({ status: false, statusText: 'Token not found.' });
        }
        await settle();

        expect(JSON.stringify(tokenOf(id))).toBe(stored);
        expect((await throughJwt(raw)).passed).toBe(true);
        expect(auditRows()).toHaveLength(0);
    });

    it('does not read a token of another workspace', async () => {
        const elsewhere = mockDbFor('6f0000000000000000000c02').seed(SCHEMA_TYPE.API_TOKENS, { name: 'Elsewhere', tokenHash: 'x', prefix: 'y', userId: MEMBER, active: true, expiresAt: new Date(T0 + DAY) });
        const res = await renew(String(elsewhere._id));
        expect(res.body).toEqual({ status: false, statusText: 'Token not found.' });
        expect(mockDbFor('6f0000000000000000000c02').calls.filter((c) => c.method !== 'find' && c.method !== 'findOne')).toHaveLength(0);
    });

    it('refuses a call made with a token, at the door and in the handler', async () => {
        const { raw, id } = seedToken({ kind: 'agent' });
        const stored = JSON.stringify(tokenOf(id));

        const atTheDoor = await throughJwt(raw, { method: 'POST', url: `/api/v2/api-tokens/${id}/renew` });
        expect(atTheDoor).toMatchObject({ passed: false, status: 403 });

        const inTheHandler = await renew(id, { apiToken: tokenOf(id) });
        expect(inTheHandler.statusCode).toBe(403);
        expect(inTheHandler.body.status).toBe(false);
        expect(inTheHandler.body.data).toBeUndefined();

        const forAnAgentRun = await renew(id, { agentRun: { _id: 'run' } });
        expect(forAnAgentRun.statusCode).toBe(403);

        expect(JSON.stringify(tokenOf(id))).toBe(stored);
    });

    it('does not bring a revoked token back', async () => {
        const { raw, id } = seedToken({ active: false });
        const res = await renew(id);
        expect(res.body.status).toBe(false);
        expect(res.body.data).toBeUndefined();
        expect(tokenOf(id).active).toBe(false);
        expect((await throughJwt(raw)).passed).toBe(false);
    });

    it('renews a token that has already ended', async () => {
        const { raw, id } = seedToken({ expiresAt: new Date(T0 - DAY) });
        expect((await throughJwt(raw)).passed).toBe(false);
        const res = await renew(id);
        expect(res.body.status).toBe(true);
        expect((await throughJwt(res.body.data.token)).passed).toBe(true);
    });

    it('refuses an id that is not one', async () => {
        const res = await renew('not-an-id');
        expect(res.body.status).toBe(false);
    });

    it('refuses an agent token whose account mode the workspace no longer allows', async () => {
        const { raw, id } = seedToken({ kind: 'agent', agentAccount: { mode: 'personal', provider: 'claude-code' } });
        globalDb().store[SCHEMA_TYPE.COMPANIES][0].agentPolicy = { allowedModes: ['workspace'] };
        const res = await renew(id);
        expect(res.statusCode).toBe(403);
        expect(res.body.status).toBe(false);
        expect((await throughJwt(raw)).passed).toBe(true);
    });

    it('lets the owner be told again before the new lifetime ends', async () => {
        const { id } = seedToken({ expiryNoticeAt: new Date(T0 - DAY) });
        await renew(id);
        expect(tokenOf(id).expiryNoticeAt).toBeUndefined();
    });
});

describe('a renewed token under API_TOKEN_STRICT', () => {
    beforeEach(() => strict(true));

    it('counts its lifetime from the renewal, so an old token is not stopped for outliving the maximum', async () => {
        const { id } = seedToken({ createdAt: new Date(T0 - 350 * DAY), expiresAt: new Date(T0 + 2 * DAY) });
        const res = await renew(id);
        expect(res.body.status).toBe(true);

        clock(T0 + 20 * DAY);
        expect((await throughJwt(res.body.data.token)).passed).toBe(true);
        const list = await call(ctrl.listTokens);
        expect(list.body.data[0].lifetimeState).toBeUndefined();

        clock(T0 + 31 * DAY);
        expect((await throughJwt(res.body.data.token)).passed).toBe(false);
    });

    it('lasts no longer than the maximum lifetime', async () => {
        maxDays(7);
        const { id } = seedToken();
        const res = await renew(id);
        expect(new Date(res.body.data.expiresAt).getTime()).toBe(T0 + 7 * DAY);
    });

    it('gives a token made without an expiry one', async () => {
        const { id } = seedToken({ expiresAt: undefined, scopes: [], createdAt: new Date(T0 - 400 * DAY) });
        const res = await renew(id);
        expect(res.body.status).toBe(true);
        expect(new Date(tokenOf(id).expiresAt).getTime()).toBe(T0 + 30 * DAY);
        expect(tokenOf(id).scopes).toEqual([]);
    });
});

describe('where renewing is declared', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

    it('is a route under the prefix no token may manage', () => {
        const routes = {};
        const register = (method) => (routePath, handler) => { routes[`${method} ${routePath}`] = handler; };
        jest.doMock('../Modules/ApiTokens/publicApi', () => ({ init: () => {} }));
        require('../Modules/ApiTokens/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), delete: register('DELETE') });
        expect(routes['POST /api/v2/api-tokens/:id/renew']).toBe(ctrl.renewToken);
        expect(read('Config/setMiddleware.js')).toMatch(/'\/api\/v2\/api-tokens',/);
    });

    it('stores what it writes in fields the schema declares', () => {
        const { schema } = jest.requireActual('../utils/mongo-handler/schema.js');
        expect(schema.apiTokens.renewedAt).toMatchObject({ type: Date });
        expect(schema.apiTokens.expiryNoticeAt).toMatchObject({ type: Date });
    });
});

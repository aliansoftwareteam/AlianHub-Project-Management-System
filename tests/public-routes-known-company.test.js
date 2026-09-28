const mockDbs = {};
const mockDbFor = (db) => { mockDbs[db] = mockDbs[db] || require('./fixtures/fakeMongo').create(); return mockDbs[db]; };
const mockOpened = [];

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (db, q, method) => { mockOpened.push(String(db)); return mockDbFor(String(db)).crud(db, q, method); },
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn(), recordAudit: jest.fn() }));
jest.mock('../Modules/Agents/actor', () => ({ resolveActor: jest.fn(async () => ({ kind: 'agent', userId: '6f0000000000000000000001' })) }));
jest.mock('../Modules/Agents/actions', () => ({ RefusedError: class RefusedError extends Error {} }));
jest.mock('../Modules/Agents/registry', () => ({ NEVER: [] }));
jest.mock('../Modules/Mcp/tools', () => ({ manifest: () => [], call: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { generateToken, hashToken } = require('../Modules/ApiTokens/helpers/apiTokenRules');
const ssoConfig = require('../Modules/SSO/config');
const oidc = require('../Modules/SSO/oidc');
const saml = require('../Modules/SSO/saml');
const { invitationPreview } = require('../Modules/Auth/controller/invitationPreview');
const mcp = require('../Modules/Mcp/server');

const KNOWN = '6f0000000000000000000c01';
const UNKNOWN = '6f0000000000000000000c99';
const OWNER = '6f0000000000000000000001';

const response = () => {
    const res = { statusCode: 200, body: undefined, headers: {} };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.send = res.json;
    res.set = jest.fn((k, v) => { res.headers[k] = v; return res; });
    res.on = jest.fn(() => res);
    res.end = jest.fn(() => res);
    res.redirect = jest.fn((url) => { res.redirectedTo = url; return res; });
    res.type = jest.fn(() => res);
    return res;
};

const publicApiHandlers = (path) => {
    const table = {};
    const register = (method) => (p, ...handlers) => { table[`${method} ${p}`] = handlers; };
    require('../Modules/ApiTokens/publicApi').init({ get: register('GET'), post: register('POST'), put: register('PUT'), delete: register('DELETE'), use: register('USE') });
    return table[`GET ${path}`];
};

const runChain = async (handlers, req, res) => {
    for (const handler of handlers) {
        let advanced = false;
        await handler(req, res, () => { advanced = true; });
        if (!advanced) break;
    }
    return res;
};

const mintToken = (companyId) => {
    const raw = generateToken();
    mockDbFor(companyId).seed(SCHEMA_TYPE.API_TOKENS, {
        name: 'script', tokenHash: hashToken(raw), prefix: raw.slice(0, 12), scopes: ['read'], userId: OWNER, active: true,
        expiresAt: new Date(Date.now() + 30 * 86400000), lastUsedAt: new Date(),
    });
    return raw;
};

const touchedUnknown = () => mockOpened.filter((db) => db === UNKNOWN);

beforeEach(() => {
    myCache.flushAll();
    mockOpened.length = 0;
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    mockDbFor(SCHEMA_TYPE.GOLBAL).seed(SCHEMA_TYPE.COMPANIES, { _id: KNOWN, Cst_CompanyName: 'Acme' });
    mockDbFor(KNOWN).seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
});

describe('a route that names a company nobody has', () => {
    it('GET /api/v2/sso/public answers "no SSO" without reaching that database', async () => {
        const res = response();
        await ssoConfig.getPublicSsoConfig({ headers: {}, query: { companyId: UNKNOWN } }, res);
        expect(res.body).toMatchObject({ status: true, data: null });
        expect(touchedUnknown()).toEqual([]);
    });

    it('GET /api/v2/sso/oidc/initiate answers 404 without reaching that database', async () => {
        const res = response();
        await oidc.oidcInitiate({ headers: {}, query: { companyId: UNKNOWN } }, res);
        expect(res.statusCode).toBe(404);
        expect(touchedUnknown()).toEqual([]);
    });

    it('GET /api/v2/sso/saml/initiate answers 404 without reaching that database', async () => {
        const res = response();
        await saml.samlInitiate({ headers: {}, query: { companyId: UNKNOWN } }, res);
        expect(res.statusCode).toBe(404);
        expect(touchedUnknown()).toEqual([]);
    });

    it('POST /api/v2/sso/saml/acs sends the browser back to the login page without reaching that database', async () => {
        const res = response();
        await saml.samlAcs({ headers: {}, query: { companyId: UNKNOWN }, body: {} }, res);
        expect(res.redirectedTo).toBe('/login?ssoError=config');
        expect(touchedUnknown()).toEqual([]);
    });

    it('POST /api/v2/auth/invitation-preview answers "invalid link" without reaching that database', async () => {
        const res = response();
        await invitationPreview({ body: { companyId: UNKNOWN, memberId: '6f00000000000000000000d1', linkId: 'x' } }, res);
        expect(res.body).toEqual({ status: false, statusText: 'Invalid invitation link.' });
        expect(touchedUnknown()).toEqual([]);
    });

    it('GET /api/public-v1/projects answers 401 without reaching that database', async () => {
        const req = { method: 'GET', originalUrl: '/api/public-v1/projects', params: {}, query: {}, body: {}, headers: { companyid: UNKNOWN, authorization: `Bearer ${generateToken()}` } };
        const res = await runChain(publicApiHandlers('/api/public-v1/projects'), req, response());
        expect(res.statusCode).toBe(401);
        expect(touchedUnknown()).toEqual([]);
    });

    it('/mcp with a personal access token answers 401 without reaching that database', async () => {
        const res = response();
        await mcp.post({ headers: { authorization: `Bearer ${generateToken()}` }, query: { companyId: UNKNOWN }, body: { jsonrpc: '2.0', id: 1, method: 'ping' }, ip: '1.1.1.1' }, res);
        expect(res.statusCode).toBe(401);
        expect(touchedUnknown()).toEqual([]);
    });

    it('is not remembered as unknown once the company exists', async () => {
        const res = response();
        await ssoConfig.getPublicSsoConfig({ headers: {}, query: { companyId: UNKNOWN } }, res);
        mockDbFor(SCHEMA_TYPE.GOLBAL).seed(SCHEMA_TYPE.COMPANIES, { _id: UNKNOWN });
        await ssoConfig.getPublicSsoConfig({ headers: {}, query: { companyId: UNKNOWN } }, response());
        expect(touchedUnknown().length).toBeGreaterThan(0);
    });

    it('treats a company being deleted as unknown', async () => {
        mockDbFor(SCHEMA_TYPE.GOLBAL).seed(SCHEMA_TYPE.COMPANIES, { _id: UNKNOWN, deletingAt: new Date() });
        await ssoConfig.getPublicSsoConfig({ headers: {}, query: { companyId: UNKNOWN } }, response());
        expect(touchedUnknown()).toEqual([]);
    });
});

describe('the same routes for a company that exists', () => {
    it('GET /api/v2/sso/public still answers with its SSO settings', async () => {
        mockDbFor(KNOWN).seed(SCHEMA_TYPE.SSO_CONFIGS, { provider: 'oidc', isEnabled: true, deletedStatusKey: 0, displayName: 'Acme SSO' });
        const res = response();
        await ssoConfig.getPublicSsoConfig({ headers: {}, query: { companyId: KNOWN } }, res);
        expect(res.body).toMatchObject({ status: true, data: { provider: 'oidc', displayName: 'Acme SSO' } });
    });

    it.each([
        ['oidc', () => oidc.oidcInitiate],
        ['saml', () => saml.samlInitiate],
    ])('GET /api/v2/sso/%s/initiate still reads its SSO settings', async (_name, handler) => {
        const res = response();
        await handler()({ headers: {}, query: { companyId: KNOWN } }, res);
        expect(res.statusCode).toBe(404);
        expect(mockOpened).toContain(KNOWN);
    });

    it('POST /api/v2/auth/invitation-preview still shows a waiting invitation', async () => {
        const row = mockDbFor(KNOWN).seed(SCHEMA_TYPE.COMPANY_USERS, { status: 1, userEmail: 'new@acme.test', linkId: 'l'.repeat(64), isDelete: false });
        const res = response();
        await invitationPreview({ body: { companyId: KNOWN, memberId: String(row._id), linkId: 'l'.repeat(64) } }, res);
        expect(res.body).toMatchObject({ status: true, data: { workspaceName: 'Acme', email: 'new@acme.test' } });
    });

    it('GET /api/public-v1/projects still answers a valid token', async () => {
        const raw = mintToken(KNOWN);
        const req = { method: 'GET', originalUrl: '/api/public-v1/projects', params: {}, query: {}, body: {}, headers: { companyid: KNOWN, authorization: `Bearer ${raw}` } };
        const res = await runChain(publicApiHandlers('/api/public-v1/projects'), req, response());
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ status: true });
    });

    it('/mcp still answers a valid personal access token', async () => {
        const raw = mintToken(KNOWN);
        const res = response();
        await mcp.post({ headers: { authorization: `Bearer ${raw}` }, query: { companyId: KNOWN }, body: { jsonrpc: '2.0', id: 1, method: 'ping' }, ip: '1.1.1.1' }, res);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
    });
});

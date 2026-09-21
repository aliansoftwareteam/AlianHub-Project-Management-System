const crypto = require('crypto');

const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {} } }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));
jest.mock('../Modules/Agents/actions', () => ({ RefusedError: class RefusedError extends Error {}, rating: () => null }));
jest.mock('../Modules/Mcp/tools', () => ({ manifest: () => [], call: jest.fn(async () => ({ ok: true })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const createSchema = require('../utils/mongo-handler/createSchema');
const server = require('../Modules/Mcp/server');
const oauthAuth = require('../Modules/Mcp/oauthAuth');
const approvalsHook = require('../Modules/Mcp/approvalsHook');
const grants = require('../Modules/OAuthServer/grants');
const clients = require('../Modules/OAuthServer/clients');
const approvalsModule = require('../Modules/OAuthServer/approvals');

/* The workspace approval holds for as long as a grant is used, not only at consent: /mcp asks it on every
 * request and narrows the token to its ceiling, the token endpoint asks it at exchange and refresh, and a
 * narrowed ceiling trims or revokes the grants above it. */

const ISSUER = 'https://hub.s10s3.test';
const RESOURCE = `${ISSUER}/mcp`;
const C = '6f0000000000000000000c71';
const OTHER_C = '6f0000000000000000000c72';
const USER = '6f0000000000000000000a71';
const ADMIN = '6f0000000000000000000a72';
const REDIRECT = 'http://127.0.0.1:41417/callback';
const ALL = ['tasks:read', 'tasks:write', 'projects:read', 'docs:read', 'time:read', 'time:write'];

const ENV_KEYS = ['MCP_OAUTH', 'APIURL', 'JWT_SECRET', 'MCP_OAUTH_ISSUER'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterAll(() => { ENV_KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); });

const rows = (type) => mockDb.store[type] || [];
const approvalRow = (clientId, over = {}) => mockDb.seed(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS, {
    companyId: C, clientId, clientName: 'S10S3 enforcement', clientKind: 'dynamic', status: 'approved', scopes: [...ALL], privateSprints: false, ...over,
});

const register = async () => (await clients.register({ kind: 'dynamic', name: 'S10S3 enforcement', redirectUris: [REDIRECT], tokenEndpointAuthMethod: 'none' })).client;

const codeFor = async (client, scopes = ['tasks:read', 'tasks:write'], companyId = C) => {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const { code, grant } = await grants.issueCode({ client, companyId, userId: USER, scopes, redirectUri: REDIRECT, codeChallenge: challenge });
    return { code, verifier, grant };
};

const exchange = (client, { code, verifier }) => grants.exchangeCode({ client, code, codeVerifier: verifier, redirectUri: REDIRECT, resource: RESOURCE });

const mint = async (scopes, { companyId = C } = {}) => {
    const client = await register();
    approvalRow(client.clientId, { companyId });
    const issued = await exchange(client, await codeFor(client, scopes, companyId));
    return { client, raw: issued.access_token, refresh: issued.refresh_token };
};

const post = async (raw) => {
    const res = { statusCode: 200, headers: {}, body: undefined };
    res.set = jest.fn((k, v) => { res.headers[k] = v; return res; });
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.end = jest.fn(() => res);
    await server.post({ headers: { authorization: `Bearer ${raw}` }, query: {}, body: { jsonrpc: '2.0', id: 1, method: 'ping' }, ip: '10.3.3.7' }, res);
    return res;
};

const setStatus = (clientId, status) => { rows(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS).find((r) => r.clientId === clientId).status = status; };

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.uniqueFromSchema(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS, createSchema.oauthClientApprovalsSchema);
    jest.clearAllMocks();
    process.env.MCP_OAUTH = 'both';
    process.env.MCP_OAUTH_ISSUER = ISSUER;
    process.env.APIURL = `${ISSUER}/`;
    process.env.JWT_SECRET = 's10s3-enforcement-secret';
    mockDb.seed(dbCollections.USERS, { _id: USER, Employee_Name: 'Priya', AssignCompany: C });
});

describe('isClientApproved, loaded the way /mcp loads it', () => {
    const load = () => approvalsHook.load();

    it('is exported by the approval module', () => {
        expect(typeof load().isClientApproved).toBe('function');
        expect(typeof load().approvedScopes).toBe('function');
    });

    it('is true only for an approved row in that workspace', async () => {
        const client = await register();
        expect(await load().isClientApproved(C, client.clientId)).toBe(false);
        approvalRow(client.clientId);
        expect(await load().isClientApproved(C, client.clientId)).toBe(true);
        expect(await load().isClientApproved(OTHER_C, client.clientId)).toBe(false);
        for (const status of ['pending', 'denied', 'revoked']) {
            setStatus(client.clientId, status);
            expect(await load().isClientApproved(C, client.clientId)).toBe(false);
        }
    });

    it('throws when the store fails, so /mcp refuses', async () => {
        const failing = jest.spyOn(require('../Modules/OAuthServer/store').approvals, 'find').mockRejectedValue(new Error('store down'));
        try {
            await expect(load().isClientApproved(C, 'ahc_000000000000000000000000')).rejects.toThrow('store down');
            await expect(load().approvedScopes(C, 'ahc_000000000000000000000000')).rejects.toThrow('store down');
        } finally {
            failing.mockRestore();
        }
    });

    it('approvedScopes answers the ceiling of an approved client and null otherwise', async () => {
        const client = await register();
        expect(await load().approvedScopes(C, client.clientId)).toBeNull();
        approvalRow(client.clientId, { scopes: ['tasks:read', 'docs:read'] });
        expect(await load().approvedScopes(C, client.clientId)).toEqual(['tasks:read', 'docs:read']);
        setStatus(client.clientId, 'revoked');
        expect(await load().approvedScopes(C, client.clientId)).toBeNull();
    });
});

describe('/mcp and the workspace approval', () => {
    it('serves an approved client and refuses it once its approval is no longer approved', async () => {
        const { client, raw } = await mint(['tasks:read']);
        expect((await post(raw)).statusCode).toBe(200);
        setStatus(client.clientId, 'revoked');
        expect((await post(raw)).statusCode).toBe(401);
    });

    it('refuses a client that was never approved in the token\'s workspace', async () => {
        const { client, raw } = await mint(['tasks:read']);
        rows(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS).find((r) => r.clientId === client.clientId).companyId = OTHER_C;
        expect((await post(raw)).statusCode).toBe(401);
    });

    it('narrows a token to the approval ceiling on every request', async () => {
        const { client, raw } = await mint(['tasks:read', 'tasks:write']);
        const before = await oauthAuth.authenticate({ headers: {} }, raw);
        expect(before.oauth.scopes).toEqual(['tasks:read', 'tasks:write']);
        expect(before.canWrite).toBe(true);
        rows(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS).find((r) => r.clientId === client.clientId).scopes = ['tasks:read'];
        const after = await oauthAuth.authenticate({ headers: {} }, raw);
        expect(after.oauth.scopes).toEqual(['tasks:read']);
        expect(after.token.scopes).toEqual(['tasks:read']);
        expect(after.canWrite).toBe(false);
    });

    it('refuses a token none of whose scopes the ceiling still allows', async () => {
        const { client, raw } = await mint(['tasks:write']);
        rows(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS).find((r) => r.clientId === client.clientId).scopes = ['tasks:read'];
        expect(await oauthAuth.authenticate({ headers: {} }, raw)).toBeNull();
    });
});

describe('the token endpoint and the workspace approval', () => {
    it('refuses to exchange a code once the approval is gone, even when it went between consent and issue', async () => {
        const client = await register();
        approvalRow(client.clientId);
        const issued = await codeFor(client);
        setStatus(client.clientId, 'revoked');
        await expect(exchange(client, issued)).rejects.toMatchObject({ error: 'invalid_grant' });
    });

    it('refuses to exchange a code whose scopes the ceiling no longer covers', async () => {
        const client = await register();
        approvalRow(client.clientId);
        const issued = await codeFor(client, ['tasks:read', 'tasks:write']);
        rows(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS)[0].scopes = ['tasks:read'];
        await expect(exchange(client, issued)).rejects.toMatchObject({ error: 'invalid_grant' });
    });

    it('refuses to refresh once the approval is gone', async () => {
        const { client, refresh } = await mint(['tasks:read']);
        setStatus(client.clientId, 'denied');
        await expect(grants.refresh({ client, refreshToken: refresh, resource: RESOURCE })).rejects.toMatchObject({ error: 'invalid_grant' });
    });

    it('refreshes only within the ceiling', async () => {
        const { client, refresh } = await mint(['tasks:read', 'tasks:write']);
        rows(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS)[0].scopes = ['tasks:read'];
        const next = await grants.refresh({ client, refreshToken: refresh, resource: RESOURCE });
        expect(next.scope).toBe('tasks:read');
    });
});

describe('narrowing an approval', () => {
    const actor = { id: ADMIN };

    it('trims every grant and live token of the client in that workspace to the new ceiling', async () => {
        const { client, refresh } = await mint(['tasks:read', 'tasks:write']);
        await approvalsModule.approve({ companyId: C, client, scopes: ['tasks:read', 'docs:read'], actor });
        const grant = rows(SCHEMA_TYPE.OAUTH_GRANTS)[0];
        expect(grant.scopes).toEqual(['tasks:read']);
        expect(grant.revokedAt).toBeFalsy();
        const live = rows(SCHEMA_TYPE.OAUTH_TOKENS).filter((r) => ['access', 'refresh'].includes(r.kind) && !r.revokedAt);
        expect(live.length).toBeGreaterThan(0);
        expect(live.every((r) => r.scopes.length === 1 && r.scopes[0] === 'tasks:read')).toBe(true);
        const next = await grants.refresh({ client, refreshToken: refresh, resource: RESOURCE });
        expect(next.scope).toBe('tasks:read');
    });

    it('revokes a grant with nothing left under the new ceiling', async () => {
        const { client, raw } = await mint(['tasks:write']);
        await approvalsModule.approve({ companyId: C, client, scopes: ['tasks:read'], actor });
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS)[0]).toMatchObject({ revokedReason: 'approval_narrowed' });
        expect((await grants.introspect(raw)).active).toBe(false);
    });

    it('leaves grants in another workspace and grants within the ceiling alone', async () => {
        const inside = await mint(['tasks:read']);
        const elsewhere = await mint(['tasks:read', 'tasks:write'], { companyId: OTHER_C });
        await approvalsModule.approve({ companyId: C, client: inside.client, scopes: ['tasks:read'], actor });
        await approvalsModule.approve({ companyId: C, client: elsewhere.client, scopes: ['tasks:read'], actor });
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS).find((g) => g.clientId === inside.client.clientId).scopes).toEqual(['tasks:read']);
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS).find((g) => g.clientId === elsewhere.client.clientId).scopes).toEqual(['tasks:read', 'tasks:write']);
    });
});

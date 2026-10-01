const crypto = require('crypto');
const { approveInWorkspace, ALL_SCOPES } = require('./fixtures/oauthApproval');
const http = require('http');
const https = require('https');

const mockDb = require('./fixtures/fakeMongo').create();
const mockOutbound = [];

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));
jest.mock('../Modules/Agents/permissions', () => ({ holderMay: jest.fn(async () => ({ allowed: true, reason: '' })) }));
jest.mock('../Modules/Tasks/helpers/completionStore', () => ({ recordWork: jest.fn(async () => null) }));
jest.mock('../Modules/Automations/engine/tools', () => {
    const actual = jest.requireActual('../Modules/Automations/engine/tools');
    return {
        ...actual,
        addComment: jest.fn(async (companyId, taskId, body, context) => {
            mockOutbound.push(['addComment', { companyId, taskId, body, context }]);
            return { changed: true, commentId: '6f0000000000000000000e41' };
        }),
        createTask: jest.fn(async (companyId, projectId, fields, context) => {
            mockOutbound.push(['createTask', { companyId, projectId, fields, context }]);
            return { taskId: '6f0000000000000000000d42', key: 'S4-1', title: fields.title };
        }),
    };
});
jest.mock('../Modules/Agents/engine/safeFetch', () => {
    const actual = jest.requireActual('../Modules/Agents/engine/safeFetch');
    return { ...actual, safeFetch: jest.fn(async (...args) => { mockOutbound.push(['safeFetch', args]); return { status: 200, headers: {}, body: '' }; }) };
});
jest.mock('../Modules/Webhooks/dispatcher', () => {
    const actual = jest.requireActual('../Modules/Webhooks/dispatcher');
    const wrapped = {};
    Object.entries(actual).forEach(([key, value]) => {
        wrapped[key] = typeof value === 'function' ? jest.fn((...args) => { mockOutbound.push([`webhooks.${key}`, args]); return undefined; }) : value;
    });
    return wrapped;
});

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { seedTaskListRules } = require('./fixtures/taskListRules');
const { dbCollections } = require('../Config/collections');
const server = require('../Modules/Mcp/server');
const grants = require('../Modules/OAuthServer/grants');
const clients = require('../Modules/OAuthServer/clients');
const automationTools = require('../Modules/Automations/engine/tools');
const agentAudit = require('../Modules/Agents/agentAudit');

/* Sprint 10 slice S4: what an OAuth-authenticated MCP call does downstream: scopes in tools.call,
 * audit attribution under the hash chain, tainted routing, and no token pass-through. */

const ISSUER = 'https://hub.s10s4.test';
const RESOURCE = `${ISSUER}/mcp`;
const C = '6f0000000000000000000c51';
const USER = '6f0000000000000000000a51';
const TASK = '6f0000000000000000000d51';
const PROJECT = '6f0000000000000000000b51';
const REDIRECT = 'http://127.0.0.1:41415/callback';
const CHAIN_KEY = 's10s4-audit-chain-key-0123456789abcdef';

const ENV_KEYS = ['MCP_OAUTH', 'APIURL', 'JWT_SECRET', 'AUDIT_CHAIN', 'AUDIT_CHAIN_KEY', 'AGENT_TAINT_ROUTING', 'MCP_TOOLS_MANAGE'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterAll(() => { ENV_KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); });

const challengeOf = (verifier) => crypto.createHash('sha256').update(verifier).digest('base64url');

/* `approved` names the scopes of the workspace's approval; left out, the fixture's approval stands as it is. */
const mint = async (scopes, approved) => {
    const { client } = await clients.register({ kind: 'dynamic', name: 'S10S4 Coder', redirectUris: [REDIRECT], tokenEndpointAuthMethod: 'none' });
    approveInWorkspace(mockDb, C, client.clientId, approved ? { scopes: approved } : {});
    const verifier = crypto.randomBytes(32).toString('base64url');
    const { code, grant } = await grants.issueCode({ client, companyId: C, userId: USER, scopes, redirectUri: REDIRECT, codeChallenge: challengeOf(verifier) });
    const issued = await grants.exchangeCode({ client, code, codeVerifier: verifier, redirectUri: REDIRECT, resource: RESOURCE });
    return { client, grant, raw: issued.access_token };
};

const call = (name, args, id = 1) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const response = () => {
    const res = { statusCode: 200, headers: {}, body: undefined };
    res.set = jest.fn((k, v) => { res.headers[k] = v; return res; });
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.end = jest.fn(() => res);
    return res;
};
const post = async (raw, body) => {
    const res = response();
    await server.post({ headers: { authorization: `Bearer ${raw}` }, query: {}, body, ip: '10.2.2.2' }, res);
    return res;
};
const resultOf = (res) => JSON.parse(res.body.result.content[0].text);
const auditRows = () => mockDb.store[SCHEMA_TYPE.AUDIT_LOGS] || [];

beforeAll(() => {
    const schemas = require('../utils/mongo-handler/createSchema');
    mockDb.uniqueFromSchema(SCHEMA_TYPE.AUDIT_LOGS, schemas.auditLogsSchema);
    mockDb.unique(SCHEMA_TYPE.AUDIT_CHAIN_HEADS, ['_id']);
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockOutbound.length = 0;
    jest.clearAllMocks();
    process.env.MCP_OAUTH = 'both';
    process.env.APIURL = `${ISSUER}/`;
    process.env.JWT_SECRET = 's10s4-actions-secret';
    delete process.env.AUDIT_CHAIN;
    delete process.env.AUDIT_CHAIN_KEY;
    delete process.env.AGENT_TAINT_ROUTING;
    delete process.env.MCP_TOOLS_MANAGE;
    mockDb.seed(dbCollections.USERS, { _id: USER, Employee_Name: 'Priya', AssignCompany: C });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: USER, roleType: 2, status: 2, isDelete: false });
    seedTaskListRules(mockDb);
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'Shared', isPrivateSpace: false, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: TASK, ProjectID: PROJECT, CompanyId: C, TaskName: 'Fix it', deletedStatusKey: 0 });
});

afterEach(async () => { await require('../Modules/Audit/chain').flushMirrors(); });

describe('tools.call reads the token\'s granted scopes', () => {
    it('refuses a write to a token with only tasks:read, in band as well as at the door', async () => {
        const tools = require('../Modules/Mcp/tools');
        const ctx = { companyId: C, userId: USER, actor: { kind: 'agent', userId: USER }, token: { oauth: true, scopes: ['tasks:read'] }, canWrite: true, ip: '' };
        await expect(tools.call(ctx, 'task.comment', { taskId: TASK, body: 'x' })).rejects.toMatchObject({ code: -32004, message: expect.stringMatching(/tasks:write/) });
        expect(automationTools.addComment).not.toHaveBeenCalled();
    });

    it('refuses a read outside the granted area', async () => {
        const tools = require('../Modules/Mcp/tools');
        const ctx = { companyId: C, userId: USER, actor: { kind: 'agent', userId: USER }, token: { oauth: true, scopes: ['tasks:write'] }, canWrite: true, ip: '' };
        await expect(tools.call(ctx, 'task.get', { taskId: TASK })).rejects.toMatchObject({ code: -32004, message: expect.stringMatching(/tasks:read/) });
    });

    it('does not let an empty OAuth scope list read as everything, the way an empty personal token does', async () => {
        const tools = require('../Modules/Mcp/tools');
        const ctx = { companyId: C, userId: USER, actor: { kind: 'agent', userId: USER }, token: { oauth: true, scopes: [] }, canWrite: true, ip: '' };
        await expect(tools.call(ctx, 'tasks.search', {})).rejects.toMatchObject({ code: -32004 });
        await expect(tools.call(ctx, 'task.comment', { taskId: TASK, body: 'x' })).rejects.toMatchObject({ code: -32004 });
    });
});

describe('audit attribution under AUDIT_CHAIN', () => {
    beforeEach(() => {
        process.env.AUDIT_CHAIN = 'true';
        process.env.AUDIT_CHAIN_KEY = CHAIN_KEY;
    });

    it('names the client, the grant and the person who delegated, and the chain still verifies', async () => {
        const { raw, client, grant } = await mint(['tasks:read', 'tasks:write']);
        const res = await post(raw, call('task.comment', { taskId: TASK, body: 'Found the cause.' }));
        expect(res.statusCode).toBe(200);
        expect(resultOf(res)).toMatchObject({ ok: true });

        const actionRow = auditRows().find((row) => row.action === agentAudit.ACTION_DONE);
        expect(actionRow).toMatchObject({ actorId: client.clientId, actorName: 'S10S4 Coder for Priya' });
        expect(actionRow.meta).toMatchObject({
            actorType: 'agent', viaAccount: 'external', clientId: client.clientId, grantId: grant.grantId, delegatedBy: USER, onBehalfOf: USER, tokenId: null,
            tainted: true, taintSources: [expect.objectContaining({ kind: 'client', ref: client.clientId })],
        });
        const folded = await agentAudit.findById(C, actionRow._id);
        expect(folded.meta.state).toBe('applied');
        expect(auditRows().every((row) => row.chain)).toBe(true);
        const chain = require('../Modules/Audit/chain');
        expect(await chain.verifyChain(C)).toMatchObject({ state: 'verified', brokenAt: null });

        const [, { context }] = mockOutbound.find(([what]) => what === 'addComment');
        expect(context).toMatchObject({ viaAccount: 'external', userId: USER, ruleName: 'S10S4 Coder for Priya' });
    });
});

describe('tainted routing (AGENT_TAINT_ROUTING)', () => {
    it('holds a risky write from an OAuth client for a person, and leaves an audited refusal', async () => {
        process.env.AGENT_TAINT_ROUTING = 'on';
        const { raw, client } = await mint(['tasks:read', 'tasks:write']);
        const res = await post(raw, call('task.create', { projectId: PROJECT, title: 'Filed from outside' }));
        expect(res.statusCode).toBe(200);
        expect(res.body.result.isError).toBe(true);
        const out = resultOf(res);
        expect(out).toMatchObject({ refused: true, action: 'task.create' });
        expect(out.reason).toMatch(/approval/);
        expect(out.reason).toMatch(/outside client/);
        expect(automationTools.createTask).not.toHaveBeenCalled();
        const refused = auditRows().find((row) => row.action === agentAudit.ACTION_REFUSED);
        expect(refused.meta).toMatchObject({ action: 'task.create', viaAccount: 'external', clientId: client.clientId, tainted: true });
    });

    it('lets a reversible task-scoped write through while tainted', async () => {
        process.env.AGENT_TAINT_ROUTING = 'on';
        const { raw } = await mint(['tasks:read', 'tasks:write']);
        const res = await post(raw, call('task.comment', { taskId: TASK, body: 'ok' }));
        expect(resultOf(res)).toMatchObject({ ok: true });
        expect(automationTools.addComment).toHaveBeenCalledTimes(1);
    });

    it('acts on the same risky write with the routing flag off, as a run would', async () => {
        const { raw } = await mint(['tasks:read', 'tasks:write']);
        const res = await post(raw, call('task.create', { projectId: PROJECT, title: 'Filed from outside' }));
        expect(resultOf(res)).toMatchObject({ ok: true });
        expect(automationTools.createTask).toHaveBeenCalledTimes(1);
    });
});

describe('visibility of an OAuth call', () => {
    const HIDDEN_PROJECT = '6f0000000000000000000b59';
    const HIDDEN_TASK = '6f0000000000000000000d59';

    beforeEach(() => {
        mockDb.store[SCHEMA_TYPE.COMPANY_USERS][0].roleType = 3;
        mockDb.seed(dbCollections.RULES, { key: 'private_projects', name: 'Private projects', roles: [{ key: 3, permission: null }] });
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: HIDDEN_PROJECT, ProjectName: 'Board only', isPrivateSpace: true, deletedStatusKey: 0, AssigneeUserId: [] });
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: HIDDEN_TASK, ProjectID: HIDDEN_PROJECT, CompanyId: C, TaskName: 'Private work', deletedStatusKey: 0 });
    });

    it('is computed for the person who granted the token, never for the client', async () => {
        const visibility = require('../Modules/Mcp/visibility');
        const spy = jest.spyOn(visibility, 'forCaller');
        const { raw, client } = await mint(['tasks:read']);
        await post(raw, call('tasks.search', {}));
        expect(spy).toHaveBeenCalled();
        const [ctx] = spy.mock.calls[0];
        expect(ctx.userId).toBe(USER);
        expect(ctx.userId).toBe(ctx.actor.delegatedBy);
        expect(ctx.userId).not.toBe(client.clientId);
        spy.mockRestore();
    });

    it('does not show an OAuth client a project the person cannot open', async () => {
        const { raw } = await mint(['tasks:read']);
        const found = resultOf(await post(raw, call('tasks.search', {})));
        const ids = found.tasks.map((t) => t.taskId);
        expect(ids).toContain(TASK);
        expect(ids).not.toContain(HIDDEN_TASK);
    });

    it('refuses a write to a task the person cannot open, and the refusal carries the taint', async () => {
        const { raw, client } = await mint(['tasks:read', 'tasks:write']);
        const res = await post(raw, call('task.comment', { taskId: HIDDEN_TASK, body: 'x' }));
        expect(resultOf(res)).toMatchObject({ refused: true });
        expect(resultOf(res).reason).toMatch(/not_visible/);
        expect(automationTools.addComment).not.toHaveBeenCalled();
        const refused = auditRows().find((row) => row.action === agentAudit.ACTION_REFUSED);
        expect(refused.meta).toMatchObject({ viaAccount: 'external', clientId: client.clientId, tainted: true, taintSources: [expect.objectContaining({ kind: 'client' })] });
    });
});

describe('no token pass-through', () => {
    const originals = {};
    const seen = [];
    const record = (what) => (...args) => {
        seen.push([what, args]);
        const req = new (require('events').EventEmitter)();
        req.end = () => {}; req.write = () => {}; req.setTimeout = () => req; req.destroy = () => {}; req.on = () => req;
        return req;
    };

    beforeEach(() => {
        seen.length = 0;
        originals.httpRequest = http.request; originals.httpsRequest = https.request;
        originals.httpGet = http.get; originals.httpsGet = https.get; originals.fetch = globalThis.fetch;
        http.request = record('http.request'); https.request = record('https.request');
        http.get = record('http.get'); https.get = record('https.get');
        globalThis.fetch = jest.fn(async (...args) => { seen.push(['fetch', args]); return new Response('{}'); });
    });

    afterEach(() => {
        http.request = originals.httpRequest; https.request = originals.httpsRequest;
        http.get = originals.httpGet; https.get = originals.httpsGet; globalThis.fetch = originals.fetch;
    });

    const flatten = (value) => {
        const out = [];
        const walk = (v, depth) => {
            if (depth > 6 || v === null || v === undefined) return;
            if (typeof v === 'string') { out.push(v); return; }
            if (v instanceof URL) { out.push(v.href); return; }
            if (typeof Headers !== 'undefined' && v instanceof Headers) { v.forEach((val, key) => out.push(`${key}: ${val}`)); return; }
            if (Buffer.isBuffer(v)) { out.push(v.toString('utf8')); return; }
            if (typeof v === 'object') Object.entries(v).forEach(([k, x]) => { out.push(k); walk(x, depth + 1); });
        };
        walk(value, 0);
        return out.join('\n');
    };

    it('never puts the inbound token in an outbound URL, header or body during reads and writes', async () => {
        process.env.AUDIT_CHAIN = 'true';
        process.env.AUDIT_CHAIN_KEY = CHAIN_KEY;
        const { raw } = await mint(['tasks:read', 'tasks:write', 'projects:read', 'docs:read', 'time:read', 'time:write']);
        const secret = raw.slice('ahoa_'.length);
        await post(raw, call('tasks.search', { query: 'x' }, 1));
        await post(raw, call('task.comment', { taskId: TASK, body: 'note' }, 2));
        await post(raw, call('task.create', { projectId: PROJECT, title: 'x' }, 3));
        await post(raw, call('task.link', { taskId: TASK, url: 'https://example.com/pr/1' }, 4));
        await post(raw, [call('timelog.start', { taskId: TASK }, 5), call('docs.read', { pageId: TASK }, 6)]);

        const outbound = flatten([...seen, ...mockOutbound]);
        expect(mockOutbound.length).toBeGreaterThan(0);
        expect(outbound).not.toContain(raw);
        expect(outbound).not.toContain(secret);
        const written = flatten(mockDb.calls.map((c) => c.data || c.query || c));
        expect(written).not.toContain(raw);
        expect(written).not.toContain(secret);
    });
});

describe('the manage tools for an OAuth client', () => {
    const MANAGING = ['tasks:read', 'tasks:write', 'tasks:manage'];
    const listed = async (raw) => (await post(raw, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).body.result.tools;
    const names = async (raw) => (await listed(raw)).map((tool) => tool.name);
    const proposalRows = () => mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS] || [];
    const approvalRow = (clientId) => mockDb.store[SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS].find((row) => row.clientId === clientId);

    it('leaves a token minted under the fixture approval with the tools and scopes it had', async () => {
        const { raw } = await mint(ALL_SCOPES);
        const before = await listed(raw);
        process.env.MCP_TOOLS_MANAGE = 'on';
        expect(await listed(raw)).toEqual(before);
        const ctx = await require('../Modules/Mcp/oauthAuth').authenticate({ headers: {} }, raw);
        expect(ctx.oauth.scopes).toEqual(ALL_SCOPES);
        const res = await post(raw, call('task.archive', { taskId: TASK }));
        expect(res.statusCode).toBe(403);
        expect(mockDb.store[SCHEMA_TYPE.TASKS][0].deletedStatusKey).toBe(0);
    });

    it('cannot be minted with a manage scope under an approval that does not name it', async () => {
        await expect(mint(MANAGING)).rejects.toMatchObject({ error: 'invalid_grant' });
    });

    it('lists them once the grant and the approval both name the scope, and drops them on the next call when either stops', async () => {
        process.env.MCP_TOOLS_MANAGE = 'on';
        const { raw, client, grant } = await mint(MANAGING, [...ALL_SCOPES, 'tasks:manage']);
        expect(await names(raw)).toEqual(expect.arrayContaining(['task.update', 'task.archive', 'tasks.batch']));
        expect(await names(raw)).not.toEqual(expect.arrayContaining(['page.update']));

        approvalRow(client.clientId).scopes = [...ALL_SCOPES];
        expect(await names(raw)).not.toEqual(expect.arrayContaining(['task.archive']));
        approvalRow(client.clientId).scopes = [...ALL_SCOPES, 'tasks:manage'];
        expect(await names(raw)).toEqual(expect.arrayContaining(['task.archive']));

        await grants.withdrawOwnManageScopes(USER, grant.grantId, ['tasks:manage']);
        expect(await names(raw)).not.toEqual(expect.arrayContaining(['task.archive']));
        expect((await post(raw, call('task.archive', { taskId: TASK }))).statusCode).toBe(403);

        approvalRow(client.clientId).status = 'revoked';
        expect((await post(raw, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).statusCode).toBe(401);
    });

    it('files a routed write for a person under the grant, and approval asks the grant again', async () => {
        process.env.MCP_TOOLS_MANAGE = 'on';
        process.env.AGENT_TAINT_ROUTING = 'on';
        const { raw, client, grant } = await mint(MANAGING, [...ALL_SCOPES, 'tasks:manage']);
        const res = await post(raw, call('task.archive', { taskId: TASK, reason: 'no longer needed' }));
        expect(res.statusCode).toBe(200);
        expect(resultOf(res)).toMatchObject({ ok: false, pending: true });
        expect(mockDb.store[SCHEMA_TYPE.TASKS][0].deletedStatusKey).toBe(0);
        const [filed] = proposalRows();
        expect(filed).toMatchObject({
            status: 'pending', source: 'mcp', requestedBy: USER, tokenId: '', oauthClientId: client.clientId, oauthGrantId: grant.grantId,
            changes: [expect.objectContaining({ action: 'task.archive', params: { taskId: TASK } })],
        });

        const approval = require('../Modules/Mcp/approval');
        const decide = () => approval.refusalFor(C, filed, { decider: { userId: USER }, isPrivileged: true });
        expect(await decide()).toBeNull();
        await grants.withdrawOwnManageScopes(USER, grant.grantId, ['tasks:manage']);
        expect(await decide()).toMatchObject({ status: 403, error: expect.stringMatching(/no longer holds the grant/) });
        await grants.revokeOwnGrant(USER, grant.grantId);
        expect(await decide()).toMatchObject({ status: 403, error: expect.stringMatching(/revoked/) });
    });

    it('refuses the same routed write to a client without the scope, as before, and files nothing', async () => {
        process.env.MCP_TOOLS_MANAGE = 'on';
        process.env.AGENT_TAINT_ROUTING = 'on';
        const { raw } = await mint(['tasks:read', 'tasks:write']);
        const res = await post(raw, call('task.create', { projectId: PROJECT, title: 'Filed from outside' }));
        expect(resultOf(res)).toMatchObject({ refused: true, action: 'task.create' });
        expect(proposalRows()).toHaveLength(0);
        expect(automationTools.createTask).not.toHaveBeenCalled();
    });
});

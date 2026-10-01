const { SCHEMA_TYPE } = require('../../Config/schemaType');
const access = require('./accessWorld');

/* The access world (an owner, an admin, a member on the private work, a member outside it, a guest; an open
 * project with a private list, a private project, the insider's personal list) as an MCP caller meets it:
 * a token that reads and writes and holds no grant. */

const { CID, OWNER, INSIDER, GUEST, P_OPEN, P_PRIVATE, P_PERSONAL, L_OPEN, settle } = access;
const TOKEN = '6f0000000000000000000101';
const MISSING = '6f0000000000000000000fff';
const T_OPEN_2 = '6f0000000000000000000d09';
const T_TWIN = '6f0000000000000000000d0a';
const CLIENT = 'https://agent.work.test/oauth/client.json';
const GRANT_ID = '0123456789abcdef0123456789abcdef';
const ISSUER = 'https://hub.work.test';
const TAGS = [{ uid: 'tag_bug', tagName: 'Bug', tagColor: '#ff0000' }, { uid: 'tag_api', tagName: 'API', tagColor: '#0000ff' }];
const PRIVATE_TAGS = [{ uid: 'tag_secret', tagName: 'Secret', tagColor: '#00ff00' }];
const PROJECT_KEYS = ['project_list', 'project_details', 'project_sprint_create', 'project_sprint_name_edit', 'sprint_type_change'];
const BEFORE = ['tasks.next', 'tasks.search', 'task.get', 'task.comment', 'task.status.set', 'task.link', 'task.create', 'subtask.create', 'timelog.start', 'timelog.stop', 'docs.read'];
const FLAGS = ['MCP_TOOLS_WORK', 'MCP_TOOLS_MANAGE', 'MCP_TOOLS_DATA', 'MCP_TOOLS_V2', 'AGENT_TAINT_ROUTING', 'MCP_OAUTH', 'MCP_OAUTH_ISSUER'];

const ctx = (uid, over = {}) => ({
    companyId: CID, userId: uid, ip: '1.1.1.1', projectIds: [], canWrite: true,
    actor: { kind: 'agent', userId: uid, agentName: 'Claude', viaAccount: 'personal', tokenId: TOKEN },
    token: { _id: TOKEN, userId: uid, scopes: ['read', 'write'], active: true },
    ...over,
});
const narrowed = (uid, projectIds) => ctx(uid, { projectIds });
const readOnly = (uid) => ctx(uid, { canWrite: false, token: { _id: TOKEN, userId: uid, scopes: ['read'], active: true } });

/* An outside client's call as the server builds it from a verified grant. */
const outside = (uid, scopes) => ctx(uid, {
    canWrite: scopes.some((scope) => scope.endsWith(':write')),
    actor: { kind: 'agent', userId: uid, agentName: 'Outside agent', viaAccount: 'external', tokenId: null, clientId: CLIENT, grantId: GRANT_ID, delegatedBy: uid },
    token: { oauth: true, scopes: [...scopes] },
    oauth: { clientId: CLIENT, grantId: GRANT_ID, scopes: [...scopes] },
    taint: { tainted: true, taintSources: [{ kind: 'client', ref: CLIENT, at: new Date() }] },
});

/* The handlers a module registers, by "METHOD path", and a call through the whole chain as a signed-in person. */
const routeTable = (init) => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers.flat(); };
    init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') });
    return table;
};

const asPerson = (table) => (key, uid, { params = {}, body = {}, query = {} } = {}) => new Promise((resolve) => {
    const [method, path] = key.split(' ');
    const res = { statusCode: 200, on: () => {} };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const req = { uid, method, originalUrl: path, baseUrl: '', route: { path }, params, query, headers: { companyid: CID }, aud: CID, body };
    const handlers = table[key];
    const step = (at) => Promise.resolve(handlers[at](req, res, () => step(at + 1)));
    step(0);
}).then(async (result) => { await settle(); return result; });

const create = (mockDb) => {
    const world = access.create(mockDb);
    const rows = (type) => mockDb.store[type] || [];
    const stored = (type, id) => rows(type).find((row) => String(row._id) === String(id));
    const audits = (action, state = null) => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.meta && row.meta.action === action && (!state || row.meta.state === state));

    const rpcThrough = (server) => async (caller, name, args) => {
        const reply = await server.handleRpc(caller, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
        await settle();
        if (reply.error) return { rpcError: reply.error };
        return { ...JSON.parse(reply.result.content[0].text), ...(reply.result.isError ? { isError: true } : {}) };
    };
    const listedThrough = (server) => async (caller) => (await server.handleRpc(caller, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools.map((tool) => tool.name);

    /* Sets what members and guests hold on a key, in the company rules. */
    const setRule = (key, permission, roles = [3, 0]) => {
        rows(SCHEMA_TYPE.RULES).filter((rule) => rule.key === key).forEach((rule) => {
            rule.roles = [3, 0].map((role) => ({ key: role, permission: roles.includes(role) ? permission : (rule.roles.find((held) => held.key === role) || {}).permission }));
        });
    };

    const seed = () => {
        const made = world.seed();
        FLAGS.forEach((flag) => { delete process.env[flag]; });
        process.env.MCP_TOOLS_WORK = 'on';
        const parent = mockDb.seed(SCHEMA_TYPE.RULES, { key: 'project', name: 'Project', isParent: true, roles: [] });
        PROJECT_KEYS.forEach((key) => mockDb.seed(SCHEMA_TYPE.RULES, { key, name: key, isParent: false, parentId: String(parent._id), roles: [{ key: 3, permission: true }, { key: 0, permission: true }] }));
        stored(SCHEMA_TYPE.PROJECTS, P_OPEN).tagsArray = TAGS.map((tag) => ({ ...tag }));
        stored(SCHEMA_TYPE.PROJECTS, P_PRIVATE).tagsArray = PRIVATE_TAGS.map((tag) => ({ ...tag }));
        stored(SCHEMA_TYPE.PROJECTS, P_PERSONAL).tagsArray = PRIVATE_TAGS.map((tag) => ({ ...tag }));
        made.seedTask(T_OPEN_2, 'Second open task', P_OPEN, L_OPEN);
        made.seedTask(T_TWIN, 'Twin of the open task', P_OPEN, L_OPEN);
        return made;
    };

    /* The grant and the workspace approval behind an outside client's call, as consent and an owner's approval leave them. */
    const seedGrant = (userId, scopes, over = {}) => {
        process.env.MCP_OAUTH = 'on';
        process.env.MCP_OAUTH_ISSUER = ISSUER;
        mockDb.seed(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS, {
            companyId: CID, clientId: CLIENT, clientName: 'Outside agent', clientKind: 'metadata_document', status: 'approved', scopes: [...scopes], privateSprints: false,
        });
        return mockDb.seed(SCHEMA_TYPE.OAUTH_GRANTS, {
            grantId: GRANT_ID, clientId: CLIENT, companyId: CID, userId, scopes: [...scopes], resource: `${ISSUER}/mcp`,
            createdAt: new Date(), expiresAt: new Date(Date.now() + 86400000), revokedAt: null, ...over,
        });
    };
    const filedBy = (uid, action, params) => ({ requestedBy: uid, tokenId: '', oauthClientId: CLIENT, oauthGrantId: GRANT_ID, tokenProjectIds: [], changes: [{ action, params }] });

    return { seed, rows, stored, audits, setRule, rpcThrough, listedThrough, seedGrant, filedBy };
};

module.exports = {
    ...access, TOKEN, MISSING, T_OPEN_2, T_TWIN, CLIENT, GRANT_ID, ISSUER, TAGS, PRIVATE_TAGS, BEFORE, FLAGS,
    ctx, narrowed, readOnly, outside, routeTable, asPerson, create,
    EVERYONE: [['an owner', OWNER], ['a member on the private work', INSIDER], ['a member outside it', access.OUTSIDER], ['a guest', GUEST]],
};

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 3), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../Modules/Agents/actor', () => ({
    resolveActor: jest.fn(async (req) => ({ kind: req.agentToken ? 'agent' : 'human', userId: req.uid })),
    isAgent: (a) => a.kind === 'agent',
    attribution: (a) => ({ actorId: a.userId, label: a.userId }),
}));
jest.mock('../Modules/Agents/agentAudit', () => ({
    recordRolePlaybookChange: jest.fn(async () => 'audit1'),
    recordRefusal: jest.fn(async () => 'refusal1'),
}));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../event/socketEventEmitter');
const agentAudit = require('../Modules/Agents/agentAudit');
const { getRoleType } = require('../Config/permissionGuard');
const { ROLE_MEMBER } = require('../Config/roleTypes');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { schema } = require('../utils/mongo-handler/schema');
const routes = require('../Modules/Agents/routes');
const ctrl = require('../Modules/Agents/rolePlaybookController');
const skillCtrl = require('../Modules/Agents/roleSkillController');
const overrides = require('../Modules/Agents/rolePlaybookOverrides');
const rolePlaybooks = require('../Modules/Agents/rolePlaybooks');
const prompts = require('../Modules/Mcp/prompts');

const C1 = '6f0000000000000000000c01';
const C2 = '6f0000000000000000000c02';
const OWNER = 1;
const BLUEPRINT = 'it-company';
const SLUG = 'bug-triager';
const BUILT_IN = rolePlaybooks.find(BLUEPRINT, SLUG).body;
const EDITED = '## Who it is\n\nThe Bug Triager of this workspace. Read the brand voice document first.\n\n## How it works\n\n1. Triage.';

const saved = process.env.MCP_ROLE_PROMPTS;
let store;

afterAll(() => { if (saved === undefined) delete process.env.MCP_ROLE_PROMPTS; else process.env.MCP_ROLE_PROMPTS = saved; });

beforeEach(() => {
    process.env.MCP_ROLE_PROMPTS = 'on';
    store = new Map();
    myCache.flushAll();
    jest.clearAllMocks();
    getRoleType.mockResolvedValue(OWNER);
    MongoDbCrudOpration.mockImplementation(async (companyId, { type, data }, op) => {
        expect(type).toBe(SCHEMA_TYPE.ROLE_PLAYBOOK_OVERRIDES);
        const rows = () => [...store.entries()].filter(([k]) => k.startsWith(`${companyId}|`)).map(([, row]) => row);
        if (op === 'find') return rows();
        const key = `${companyId}|${data[0].key}`;
        if (op === 'findOneAndUpdate') {
            store.set(key, { key: data[0].key, ...data[1].$set });
            return store.get(key);
        }
        if (op === 'deleteOne') { store.delete(key); return { deletedCount: 1 }; }
        throw new Error(`unexpected ${op}`);
    });
});

const res = () => {
    const r = { code: 200, body: null, headers: {} };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.json = r.send;
    r.set = (k, v) => { r.headers[k.toLowerCase()] = v; return r; };
    return r;
};
const req = (over = {}) => ({
    headers: { companyid: C1 }, aud: C1, uid: 'u1', params: { blueprint: BLUEPRINT, slug: SLUG }, query: {}, body: {}, ip: '1.2.3.4', ...over,
});
const run = async (handlers, over) => {
    const r = res();
    const request = req(over);
    for (const handler of [].concat(handlers)) {
        let advanced = false;
        await handler(request, r, () => { advanced = true; });
        if (!advanced) break;
    }
    return r;
};
const put = (body, over) => run(ctrl.putRolePlaybook, { body: { body }, ...over });
const restore = (over) => run(ctrl.deleteRolePlaybook, over);
const list = (over) => run(ctrl.listRoles, over);

describe('tuning a role playbook for a workspace', () => {
    it('keeps the override in a strict, company-scoped store', () => {
        expect(SCHEMA_TYPE.ROLE_PLAYBOOK_OVERRIDES).toBe('role_playbook_overrides');
        expect(Object.keys(schema.rolePlaybookOverrides)).toEqual(['key', 'body', 'updatedBy']);
        const { rolePlaybookOverridesSchema } = require('../utils/mongo-handler/createSchema');
        expect(rolePlaybookOverridesSchema.options.strict).toBe(true);
    });

    it('is registered under the agent routes', () => {
        const app = { use: jest.fn(), get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
        routes.init(app);
        expect(app.get).toHaveBeenCalledWith('/api/v2/agents/roles', ctrl.listRoles);
        expect(app.put).toHaveBeenCalledWith('/api/v2/agents/roles/:blueprint/:slug/playbook', ctrl.putRolePlaybook);
        expect(app.delete).toHaveBeenCalledWith('/api/v2/agents/roles/:blueprint/:slug/playbook', ctrl.deleteRolePlaybook);
    });

    it('lets an owner save, then reads it back with the built-in text beside it', async () => {
        const out = await put(EDITED);
        expect(out.code).toBe(200);
        const row = out.body.data.roles.find((r) => r.slug === SLUG);
        expect(row).toMatchObject({ body: EDITED, default: BUILT_IN, edited: true });
        expect(out.body.data.canEdit).toBe(true);
        const read = await list();
        expect(read.body.data.roles.find((r) => r.slug === SLUG)).toMatchObject({ body: EDITED, edited: true });
        expect(read.body.data.roles.find((r) => r.slug === 'tech-lead').edited).toBe(false);
    });

    it('writes an audit row, emits to the company and clears the cache on a save and on a restore', async () => {
        await list();
        expect(myCache.get(`rolePlaybookOverrides:${C1}`)).toBeDefined();
        await put(EDITED);
        expect(myCache.get(`rolePlaybookOverrides:${C1}`)).toEqual([[`${BLUEPRINT}/${SLUG}`, EDITED]]);
        expect(agentAudit.recordRolePlaybookChange).toHaveBeenCalledWith(C1, expect.objectContaining({ userId: 'u1' }), expect.objectContaining({ restored: undefined, from: BUILT_IN, to: EDITED }));
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ companyId: C1, module: 'agent', data: expect.objectContaining({ kind: 'role_playbook' }) }));
        await restore();
        expect(myCache.get(`rolePlaybookOverrides:${C1}`)).toEqual([]);
        expect(agentAudit.recordRolePlaybookChange).toHaveBeenLastCalledWith(C1, expect.anything(), expect.objectContaining({ restored: true, from: EDITED, to: BUILT_IN }));
        expect(socketEmitter.emit).toHaveBeenCalledTimes(2);
    });

    it('restores the built-in text', async () => {
        await put(EDITED);
        const out = await restore();
        expect(out.code).toBe(200);
        expect(out.body.data.roles.find((r) => r.slug === SLUG)).toMatchObject({ body: BUILT_IN, edited: false });
        expect(store.size).toBe(0);
    });

    it('refuses a member, a guest and a stranger, saves nothing, and shows someone outside the members no role', async () => {
        getRoleType.mockResolvedValue(ROLE_MEMBER);
        expect((await put(EDITED)).code).toBe(403);
        expect((await restore()).code).toBe(403);
        getRoleType.mockResolvedValue(null);
        expect((await put(EDITED)).code).toBe(403);
        expect((await put(EDITED, { aud: C2 })).code).toBe(403);
        const outside = await list();
        expect(outside.code).toBe(200);
        expect(outside.body.data).toEqual({ on: false, roles: [] });
        expect(store.size).toBe(0);
        expect(agentAudit.recordRolePlaybookChange).not.toHaveBeenCalled();
        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });

    it('lets a member read the roles but not edit them', async () => {
        getRoleType.mockResolvedValue(ROLE_MEMBER);
        const out = await list();
        expect(out.code).toBe(200);
        expect(out.body.data.canEdit).toBe(false);
    });

    it('refuses an agent and an API token, and records the agent\'s attempt', async () => {
        const byAgent = await put(EDITED, { agentToken: true, apiToken: { _id: 't2' } });
        expect(byAgent.code).toBe(403);
        expect(agentAudit.recordRefusal).toHaveBeenCalledWith(C1, expect.objectContaining({ kind: 'agent' }), expect.objectContaining({ action: 'agent.role_playbook.edit' }));
        const restoredByAgent = await restore({ agentToken: true, apiToken: { _id: 't2' } });
        expect(restoredByAgent.code).toBe(403);
        expect((await put(EDITED, { apiToken: { _id: 't1' } })).code).toBe(403);
        expect((await restore({ apiToken: { _id: 't1' } })).code).toBe(403);
        expect(store.size).toBe(0);
        expect(agentAudit.recordRolePlaybookChange).not.toHaveBeenCalled();
    });

    it('refuses empty, non-text and oversized text, and a role that does not exist', async () => {
        expect((await put('   ')).code).toBe(400);
        expect((await put(42)).code).toBe(400);
        expect((await put(undefined)).code).toBe(400);
        expect((await put('x'.repeat(overrides.BODY_MAX + 1))).code).toBe(400);
        expect((await put(EDITED, { params: { blueprint: BLUEPRINT, slug: 'nobody' } })).code).toBe(404);
        expect((await restore({ params: { blueprint: 'manufacturing', slug: SLUG } })).code).toBe(404);
        expect(store.size).toBe(0);
    });

    it('refuses edits and lists no role, without an error, while MCP_ROLE_PROMPTS is off', async () => {
        delete process.env.MCP_ROLE_PROMPTS;
        expect((await put(EDITED)).code).toBe(404);
        const off = await list();
        expect(off.code).toBe(200);
        expect(off.body.data).toEqual({ on: false, roles: [] });
    });

    it('keeps one workspace\'s text from another', async () => {
        await put(EDITED);
        expect((await overrides.findFor(C1, BLUEPRINT, SLUG)).body).toBe(EDITED);
        expect((await overrides.findFor(C2, BLUEPRINT, SLUG)).body).toBe(BUILT_IN);
    });

    it('reads a text saved on another instance within 60 seconds, since only this process\'s cache is cleared', async () => {
        const start = Date.now();
        const clock = jest.spyOn(Date, 'now').mockReturnValue(start);
        try {
            expect((await overrides.findFor(C1, BLUEPRINT, SLUG)).body).toBe(BUILT_IN);
            store.set(`${C1}|${BLUEPRINT}/${SLUG}`, { key: `${BLUEPRINT}/${SLUG}`, body: EDITED });
            clock.mockReturnValue(start + 59 * 1000);
            expect((await overrides.findFor(C1, BLUEPRINT, SLUG)).body).toBe(BUILT_IN);
            clock.mockReturnValue(start + 61 * 1000);
            expect((await overrides.findFor(C1, BLUEPRINT, SLUG)).body).toBe(EDITED);
        } finally {
            clock.mockRestore();
        }
        expect(overrides.CACHE_SECONDS).toBeLessThanOrEqual(60);
    });

    it('reads as the built-in text when the store cannot be read', async () => {
        MongoDbCrudOpration.mockRejectedValue(new Error('down'));
        expect((await overrides.findFor(C1, BLUEPRINT, SLUG)).body).toBe(BUILT_IN);
    });
});

describe('where the tuned text is used', () => {
    it('is in the downloaded skill, and only for the workspace that edited it', async () => {
        await put(EDITED);
        const download = async (over) => { const r = res(); await skillCtrl.downloadRoleSkill(req(over), r); return r.body.toString('utf8'); };
        expect(await download()).toContain('Read the brand voice document first.');
        expect(await download({ headers: { companyid: C2 }, aud: C2 })).not.toContain('Read the brand voice document first.');
        await restore();
        expect(await download()).not.toContain('Read the brand voice document first.');
    });

    it('is the "who it is" line the dispatcher reads, only for the workspace that edited it', async () => {
        const key = `${BLUEPRINT}/${SLUG}`;
        const builtIn = await rolePlaybooks.whoFor(C1, key);
        expect(builtIn).toBe(rolePlaybooks.summary(rolePlaybooks.find(BLUEPRINT, SLUG), 300));
        await put(EDITED);
        expect(await rolePlaybooks.whoFor(C1, key)).toBe('The Bug Triager of this workspace. Read the brand voice document first.');
        expect(await rolePlaybooks.whoFor(C2, key)).toBe(builtIn);
        await restore();
        expect(await rolePlaybooks.whoFor(C1, key)).toBe(builtIn);
        expect(await rolePlaybooks.whoFor(C1, 'no/such-role')).toBe('');
    });

    it('is in the MCP role prompt, and the built-in text comes back after a restore', async () => {
        const name = prompts.rolePromptName(rolePlaybooks.find(BLUEPRINT, SLUG));
        const edited = new Map([[`${BLUEPRINT}/${SLUG}`, EDITED]]);
        const texts = prompts.rolePrompts(edited).find((p) => p.name === name).text(() => true, { request: '' }).join('\n');
        expect(texts).toContain('Read the brand voice document first.');
        expect(texts).not.toContain(BUILT_IN);
        const builtIn = prompts.rolePrompts(new Map()).find((p) => p.name === name).text(() => true, { request: '' }).join('\n');
        expect(builtIn).toContain(BUILT_IN);
    });
});

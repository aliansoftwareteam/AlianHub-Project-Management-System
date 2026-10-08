jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 3), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../Modules/Agents/actor', () => ({
    resolveActor: jest.fn(async (req) => ({ kind: req.agentToken ? 'agent' : 'human', userId: req.uid })),
    isAgent: (a) => a.kind === 'agent',
}));

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { getRoleType } = require('../Config/permissionGuard');
const { ROLE_GUEST, ROLE_MEMBER } = require('../Config/roleTypes');
const { verifyJWTTokenWithCV2 } = require('../Config/jwt');
const routes = require('../Modules/Agents/routes');
const ctrl = require('../Modules/Agents/roleSkillController');
const roleSkill = require('../Modules/Agents/roleSkill');
const rolePlaybooks = require('../Modules/Agents/rolePlaybooks');

const C = '6f0000000000000000000c01';
const ROUTE = '/api/v2/agents/roles/:blueprint/:slug/skill';
const saved = process.env.MCP_ROLE_PROMPTS;
afterAll(() => { if (saved === undefined) delete process.env.MCP_ROLE_PROMPTS; else process.env.MCP_ROLE_PROMPTS = saved; });
beforeEach(() => {
    process.env.MCP_ROLE_PROMPTS = 'on';
    getRoleType.mockResolvedValue(ROLE_MEMBER);
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
    headers: { companyid: C }, aud: C, uid: 'u1', params: { blueprint: 'it-company', slug: 'bug-triager' }, query: {}, body: {}, ...over,
});
const download = async (over) => { const r = res(); await ctrl.downloadRoleSkill(req(over), r); return r; };

const frontmatterOf = (markdown) => {
    const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
    return match ? yaml.load(match[1]) : null;
};

describe('downloading a role as a Claude skill', () => {
    it('is registered under the signed-in, company-scoped /api/v2/agents prefix', () => {
        const app = { use: jest.fn(), get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
        routes.init(app);
        expect(app.get).toHaveBeenCalledWith(ROUTE, ctrl.downloadRoleSkill);
        expect(fs.readFileSync(path.join(__dirname, '../Config/setMiddleware.js'), 'utf8')).toMatch(/'\/api\/v2\/agents'/);
    });

    it('needs a signed-in session: the guard on that prefix answers 401 without one', async () => {
        const next = jest.fn();
        const r = res();
        await verifyJWTTokenWithCV2({ headers: { companyid: C }, cookies: {}, query: {} }, r, next);
        expect(r.code).toBe(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('answers only for a company the session holds, and only to a member', async () => {
        expect((await download({ aud: '6f0000000000000000000c02' })).code).toBe(403);
        expect((await download({ headers: {} })).code).toBe(403);
        expect((await download({ agentToken: true })).code).toBe(403);
        getRoleType.mockResolvedValue(ROLE_GUEST);
        expect((await download()).code).toBe(403);
        getRoleType.mockResolvedValue(null);
        expect((await download()).code).toBe(403);
    });

    it('is not there while MCP_ROLE_PROMPTS is off', async () => {
        delete process.env.MCP_ROLE_PROMPTS;
        const r = await download();
        expect(r.code).toBe(404);
        expect(r.body.status).toBe(false);
    });

    it('answers 404 for a role that does not exist', async () => {
        expect((await download({ params: { blueprint: 'it-company', slug: 'nobody' } })).code).toBe(404);
        expect((await download({ params: { blueprint: 'manufacturing', slug: 'bug-triager' } })).code).toBe(404);
    });

    it('sends a zip holding <name>/SKILL.md', async () => {
        const r = await download();
        expect(r.code).toBe(200);
        expect(r.headers['content-type']).toBe('application/zip');
        expect(r.headers['content-disposition']).toBe('attachment; filename="alianhub-bug-triager.zip"');
        expect(Buffer.isBuffer(r.body)).toBe(true);
        expect(r.body.subarray(0, 2).toString()).toBe('PK');
        const text = r.body.toString('utf8');
        expect(text).toContain('alianhub-bug-triager/SKILL.md');
        expect(text).toContain(roleSkill.skillMarkdown(rolePlaybooks.find('it-company', 'bug-triager')));
    });

    it('gives every role a SKILL.md whose frontmatter Claude accepts, followed by the playbook', () => {
        const wrong = rolePlaybooks.all().flatMap((role) => {
            const markdown = roleSkill.skillMarkdown(role);
            const meta = frontmatterOf(markdown);
            const faults = [];
            if (!meta) return [`${role.slug}: no frontmatter`];
            if (Object.keys(meta).join() !== 'name,description') faults.push('keys');
            if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(meta.name) || meta.name.length > 64 || /anthropic|claude/.test(meta.name)) faults.push('name');
            if (typeof meta.description !== 'string' || !meta.description || meta.description.length > 1024 || /[<>]/.test(meta.description)) faults.push('description');
            if (!meta.description.startsWith(`Work as the ${role.name} (${role.department}) in AlianHub`)) faults.push('description lead');
            if (!markdown.includes(`\n${role.body}\n`)) faults.push('playbook');
            return faults.map((fault) => `${role.blueprint}/${role.slug}: ${fault}`);
        });
        expect(wrong).toEqual([]);
        expect(frontmatterOf(roleSkill.skillMarkdown(rolePlaybooks.find('it-company', 'bug-triager'))).name).toBe('alianhub-bug-triager');
    });

    it('keeps the frontmatter valid whatever the summary holds', () => {
        const role = { ...rolePlaybooks.find('it-company', 'bug-triager'), name: 'Odd: "quoted" <role>', body: '## Who it is\n\nIt says: "yes" # not a comment <b>.\n' };
        const meta = frontmatterOf(roleSkill.skillMarkdown(role));
        expect(meta.description).toBe('Work as the Odd: "quoted" role (Engineering) in AlianHub, through the AlianHub connector. It says: "yes" # not a comment b . Use it when someone asks for this role\'s work in AlianHub.');
    });
});

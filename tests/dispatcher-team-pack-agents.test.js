const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn((key) => require('../Config/config').myCache.del(key)) }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn(), recordAuditFromReq: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const socketEmitter = require('../event/socketEventEmitter');
const { removeCache } = require('../utils/commonFunctions');
const { recordAudit } = require('../Modules/Audit/recorder');
const playbooks = require('../Modules/Agents/rolePlaybooks');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const EDITOR = 'a00000000000000000000002';
const VIEWER = 'a00000000000000000000003';
const MEMBER_ROLE = 3;
const PACKS = '/api/v2/assignment-rules/dispatcher/team-packs';
const SETTINGS = '/api/v2/assignment-rules/dispatcher/project/:projectId';
const TRIAGER = 'it-company/bug-triager';
const DESIGN_LEAD = 'it-company/design-lead';

const oid = () => new mongoose.Types.ObjectId().toString();
const engineering = playbooks.all().filter((role) => role.blueprint === 'it-company' && role.team === 'engineering').map((role) => `${role.blueprint}/${role.slug}`);

const routes = () => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers; };
    require('../Modules/AssignmentRules/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE') });
    return table;
};

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.send = res.json;
    return res;
};

const call = async (method, path, { uid = EDITOR, params = {}, body = {}, extra = {} } = {}) => {
    const handlers = routes()[`${method} ${path}`];
    if (!handlers) throw new Error(`no route ${method} ${path}`);
    const req = verified({ uid, method, originalUrl: path, params, body, query: {}, headers: { companyid: C }, ...extra });
    const res = response();
    for (const handler of handlers) {
        let advanced = false;
        await handler(req, res, () => { advanced = true; });
        if (!advanced) break;
    }
    return res;
};

const seedRules = (grants = {}) => {
    const parents = {};
    const parentOf = (section) => {
        if (!parents[section]) parents[section] = mockDb.seed(SCHEMA_TYPE.RULES, { key: section, isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }] });
        return parents[section];
    };
    Object.entries(grants).forEach(([path, permission]) => {
        const [section, key] = path.split('.');
        mockDb.seed(SCHEMA_TYPE.RULES, { key, isParent: false, parentId: String(parentOf(section)._id), roles: [{ key: MEMBER_ROLE, permission }] });
    });
};

const GRANTS = { 'project.private_projects': 1, 'project.project_details': true };

const seedProject = (doc = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, {
    _id: oid(), ProjectName: 'Launch', CompanyId: C, isPrivateSpace: true, AssigneeUserId: [OWNER, EDITOR, VIEWER], isGlobalPermission: true, ...doc,
});

const store = (type) => mockDb.store[type] || [];
const audited = () => recordAudit.mock.calls.map(([companyId, entry]) => ({ companyId, ...entry })).filter((entry) => entry.action.startsWith('dispatcher.pack_'));
const applyPack = (projects, { uid = EDITOR, teams = ['engineering'], extra } = {}) => call('POST', PACKS, {
    uid, extra, body: { blueprint: 'it-company', teams, projectIds: projects.map((project) => String(project._id)) },
});

let emitted;
beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    mockDb.seed(dbCollections.COMPANIES, { _id: C });
    [[OWNER, 1], [EDITOR, MEMBER_ROLE], [VIEWER, MEMBER_ROLE]].forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    [[OWNER, 'Olive'], [EDITOR, 'Eddie'], [VIEWER, 'Vic']].forEach(([_id, Employee_Name]) => mockDb.seed(SCHEMA_TYPE.USERS, { _id, Employee_Name }));
    process.env.PERMISSION_ENFORCEMENT_MODE = 'enforce';
    process.env.DISPATCHER = 'on';
    recordAudit.mockClear();
    removeCache.mockClear();
    emitted = [];
    socketEmitter.on('update', (payload) => emitted.push(payload));
});

afterEach(() => {
    socketEmitter.removeAllListeners('update');
    delete process.env.PERMISSION_ENFORCEMENT_MODE;
    delete process.env.DISPATCHER;
});

const agentsOf = () => store(SCHEMA_TYPE.AGENTS);
const live = () => agentsOf().filter((agent) => agent.deletedStatusKey !== 1);
const ids = (project) => [String(project._id)];

describe('team packs make one agent per role', () => {
    it('creates an agent per role, named, scoped, with a skill from the playbook, off every schedule, and says so everywhere', async () => {
        seedRules(GRANTS);
        const one = seedProject();
        const two = seedProject();
        recordAudit.mockClear();
        emitted = [];
        removeCache.mockClear();

        const res = await applyPack([one, two]);
        expect(res.statusCode).toBe(200);
        expect(res.body.data.agents.made).toHaveLength(engineering.length);
        expect(live()).toHaveLength(engineering.length);
        const triager = live().find((agent) => agent.role === TRIAGER);
        expect(triager).toMatchObject({
            name: 'Bug Triager · IT company', projectIds: [String(one._id), String(two._id)], paused: true, pausedReason: 'team_pack', autonomy: 1, ownerId: EDITOR, madeBy: 'team-pack:it-company', skills: [{ key: 'role.bug-triager', enabled: true }],
        });
        expect(triager.autonomy).toBeLessThan(3);
        expect(triager.trigger).toBeUndefined();
        const skill = store(SCHEMA_TYPE.AGENT_SKILLS).find((row) => row.key === 'role.bug-triager');
        expect(skill.prompt.instructions).toContain(playbooks.find('it-company', 'bug-triager').body.slice(0, 80));
        expect(store(SCHEMA_TYPE.AGENT_SKILLS)).toHaveLength(engineering.length);
        expect(audited()).toEqual([expect.objectContaining({ action: 'dispatcher.pack_applied', meta: expect.objectContaining({ agents: expect.objectContaining({ created: res.body.data.agents.made.map((a) => a.agentId) }) }) })]);
        expect(emitted.filter((e) => e.module === 'dispatcherAgents' && e.companyId === C)).toHaveLength(1);
        expect(emitted.filter((e) => e.module === 'agent' && e.companyId === C).length).toBeGreaterThanOrEqual(engineering.length);
        expect(removeCache.mock.calls.map(([key]) => key).filter((key) => key.startsWith('agents:'))).toEqual([]);
        expect(store(SCHEMA_TYPE.AGENT_REVISIONS).length).toBeGreaterThanOrEqual(engineering.length);
    });

    it('gives each agent its role\'s playbook tools, the queue tools among them, as far as the registry knows them', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await applyPack([project]);
        const registry = require('../Modules/Agents/registry');
        const triager = live().find((agent) => agent.role === TRIAGER);
        expect(triager.allowedActions).toEqual(expect.arrayContaining(['queue.list', 'queue.claim', 'queue.release', 'task.get', 'task.comment', 'task.update']));
        expect(triager.allowedActions).not.toContain('task.from_message');
        live().forEach((agent) => {
            expect(agent.allowedActions.length).toBeGreaterThan(2);
            expect(agent.allowedActions.every((key) => registry.knows(key))).toBe(true);
        });
    });

    it('never duplicates an agent for the same role and projects, and makes a new one for other projects', async () => {
        seedRules(GRANTS);
        const one = seedProject();
        const two = seedProject();
        await applyPack([one]);
        const again = await applyPack([one]);
        expect(again.body.data.agents.made).toEqual([]);
        expect(again.body.data.agents.kept).toHaveLength(engineering.length);
        expect(live()).toHaveLength(engineering.length);
        const other = await applyPack([one, two]);
        expect(other.body.data.agents.made).toHaveLength(engineering.length);
        expect(live()).toHaveLength(engineering.length * 2);
    });

    it('leaves agents out when asked, and a person\'s own agent for the role counts as the one', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: oid(), name: 'Mine', role: TRIAGER, projectIds: ids(project), deletedStatusKey: 0, ownerId: OWNER });
        const res = await call('POST', PACKS, { body: { blueprint: 'it-company', teams: ['engineering'], projectIds: ids(project), createAgents: false } });
        expect(res.body.data.agents).toEqual({ made: [], kept: [] });
        expect(live()).toHaveLength(1);
        const on = await applyPack([project]);
        expect(on.body.data.agents.kept.map((a) => a.roleKey)).toEqual([TRIAGER]);
        expect(live()).toHaveLength(engineering.length);
    });

    it('routes nothing and offers no mention to the new agents until a person switches one on, and the org chart lists them', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        const res = await applyPack([project]);
        await call('PUT', SETTINGS, { params: { projectId: String(project._id) }, body: { mode: 'apply', threshold: 80, roles: engineering, rules: [] } });
        const queue = require('../Modules/AssignmentRules/dispatcher/queue');
        expect(await queue.leastLoaded(C, TRIAGER, String(project._id))).toBeNull();
        const mine = res.body.data.agents.made.find((a) => a.roleKey === TRIAGER).agentId;
        const mentionable = await require('../Modules/Agents/triggers').runnableAgents(C, OWNER, { _id: oid(), ProjectID: String(project._id), AssigneeUserId: [] });
        expect(mentionable.map((agent) => String(agent._id))).not.toContain(mine);
        agentsOf().find((agent) => String(agent._id) === mine).paused = false;
        const picked = await queue.leastLoaded(C, TRIAGER, String(project._id));
        expect(picked.id).toBe(mine);
        const chart = await call('GET', '/api/v2/assignment-rules/dispatcher/company/org-chart', { uid: OWNER });
        const role = chart.body.data.blueprints.flatMap((b) => b.teams).flatMap((t) => t.roles).find((r) => r.key === TRIAGER);
        expect(role.agents.map((a) => a.id)).toEqual([picked.id]);
    });

    it('undoes by removing only the agents it made that did no work, and keeps and names the rest', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        const applied = await applyPack([project]);
        const made = applied.body.data.agents.made;
        const worked = made.find((a) => a.roleKey === TRIAGER).agentId;
        mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: worked, startedAt: new Date() });
        const mine = oid();
        mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: mine, name: 'Hand made', role: DESIGN_LEAD, projectIds: ids(project), deletedStatusKey: 0 });
        recordAudit.mockClear();

        const res = await call('POST', PACKS, {
            body: { undo: true, blueprint: 'it-company', teams: ['engineering'], projectIds: ids(project), roles: { [String(project._id)]: applied.body.data.projects[0].added }, agents: [...made.map((a) => a.agentId), mine] },
        });
        expect(res.statusCode).toBe(200);
        expect(res.body.data.agents.removed).toHaveLength(made.length - 1);
        expect(res.body.data.agents.kept).toEqual([expect.objectContaining({ agentId: worked, why: 'has_worked' }), expect.objectContaining({ agentId: mine, why: 'not_made_by_pack' })]);
        expect(live().map((a) => String(a._id)).sort()).toEqual([worked, mine].sort());
        expect(audited()).toEqual([expect.objectContaining({ action: 'dispatcher.pack_undone', meta: expect.objectContaining({ agents: expect.objectContaining({ kept: [worked, mine] }) }) })]);
    });

    it('keeps an agent that was handed queue work, or that reaches a project the undo was not checked for', async () => {
        seedRules(GRANTS);
        const one = seedProject();
        const two = seedProject();
        const first = await applyPack([one]);
        const wide = await applyPack([one, two]);
        const handed = first.body.data.agents.made[0].agentId;
        mockDb.seed(SCHEMA_TYPE.PROJECT_FINDINGS, { rule: 'handed_over', status: 'open', facts: { agentId: handed } });
        const res = await call('POST', PACKS, {
            body: { undo: true, blueprint: 'it-company', teams: ['engineering'], projectIds: ids(one), roles: {}, agents: [handed, wide.body.data.agents.made[0].agentId] },
        });
        expect(res.body.data.agents.removed).toEqual([]);
        expect(res.body.data.agents.kept.map((a) => a.why)).toEqual(['has_worked', 'other_projects']);
    });

    it('refuses agent ids that are not ids', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        const res = await call('POST', PACKS, { body: { undo: true, blueprint: 'it-company', teams: ['engineering'], projectIds: ids(project), roles: {}, agents: ['nope'] } });
        expect(res.statusCode).toBe(400);
        expect(live()).toHaveLength(0);
    });

    it('creates nothing for a member without project details, or an agent', async () => {
        seedRules({});
        const project = seedProject();
        expect((await applyPack([project])).statusCode).toBe(403);
        const token = { apiToken: { _id: oid(), kind: 'agent', userId: OWNER, name: 'Claude', scopes: ['read', 'write'] } };
        expect((await applyPack([project], { uid: OWNER, extra: token })).statusCode).toBe(403);
        expect(agentsOf()).toHaveLength(0);
    });

    it('builds a valid skill from every playbook in every blueprint', async () => {
        const { validateSkill } = require('../Modules/Agents/skills/validateSkill');
        const roleSkill = require('../Modules/Agents/roleSkill');
        for (const role of playbooks.all()) {
            const made = {};
            const skills = { findData: async () => null, createSkill: async (company, input) => { made.input = input; return input; } };
            jest.spyOn(require('../Modules/Agents/skillRecord'), 'findData').mockImplementation(skills.findData);
            jest.spyOn(require('../Modules/Agents/skillRecord'), 'createSkill').mockImplementation(skills.createSkill);
            await require('../Modules/AssignmentRules/dispatcher/packAgents').create(C, [`${role.blueprint}/${role.slug}`], [oid()], OWNER);
            const checked = validateSkill(made.input);
            expect(checked.errors || []).toEqual([]);
            expect(made.input.description).toBe(roleSkill.skillDescription(role));
            jest.restoreAllMocks();
        }
    });
});

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

const call = async (method, path, { uid = OWNER, params = {}, body = {}, extra = {} } = {}) => {
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
const applyPack = (projects, { uid = OWNER, teams = ['engineering'], extra } = {}) => call('POST', PACKS, {
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
            name: 'Bug Triager · IT company', projectIds: [String(one._id), String(two._id)], paused: true, pausedReason: 'team_pack', autonomy: 1, ownerId: OWNER, madeBy: 'team-pack:it-company', skills: [{ key: 'role.bug-triager', enabled: true }],
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

    it('reuses the role\'s agent whose projects overlap, widening it to the new ones, and makes one only for projects no agent reaches', async () => {
        seedRules(GRANTS);
        const one = seedProject();
        const two = seedProject();
        const three = seedProject();
        const first = await applyPack([one]);
        const again = await applyPack([one]);
        expect(again.body.data.agents).toMatchObject({ made: [], widened: [] });
        expect(again.body.data.agents.kept).toHaveLength(engineering.length);
        const wider = await applyPack([one, two]);
        expect(wider.body.data.agents.made).toEqual([]);
        expect(wider.body.data.agents.widened.map((a) => a.agentId).sort()).toEqual(first.body.data.agents.made.map((a) => a.agentId).sort());
        expect(wider.body.data.agents.widened[0].projectIds).toEqual(ids(two));
        expect(live()).toHaveLength(engineering.length);
        expect(live().find((agent) => agent.role === TRIAGER).projectIds.map(String)).toEqual([String(one._id), String(two._id)]);
        expect(audited().pop().meta.agents.widened).toHaveLength(engineering.length);
        const apart = await applyPack([three]);
        expect(apart.body.data.agents.made).toHaveLength(engineering.length);
        expect(live()).toHaveLength(engineering.length * 2);
    });

    it('finds the overlapping agent however many agents play the role', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        for (let i = 0; i < 600; i += 1) mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: oid(), name: `Elsewhere ${i}`, role: TRIAGER, projectIds: [oid()], deletedStatusKey: 0, createdAt: new Date(1000 + i) });
        const mine = oid();
        mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: mine, name: 'Mine', role: TRIAGER, projectIds: ids(project), deletedStatusKey: 0, createdAt: new Date(5000) });
        const res = await applyPack([project]);
        expect(res.body.data.agents.made.map((a) => a.roleKey)).not.toContain(TRIAGER);
        expect(res.body.data.agents.kept).toEqual([expect.objectContaining({ roleKey: TRIAGER, agentId: mine })]);
    });

    it('lets one of two packs applied at once through and turns the other away, so no role gets two agents', async () => {
        mockDb.unique(SCHEMA_TYPE.AGENT_WORK_MARKS, ['scope', 'key']);
        seedRules(GRANTS);
        const project = seedProject();
        const [a, b] = await Promise.all([applyPack([project]), applyPack([project])]);
        expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
        expect([a, b].find((res) => res.statusCode === 409).body.message).toContain('Another team pack is being applied');
        expect(live()).toHaveLength(engineering.length);
        expect((await applyPack([project])).statusCode).toBe(200);
        expect(live()).toHaveLength(engineering.length);
    });

    it('waits for a pack change that holds the lock, and takes over one whose lease ran out', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        const mark = mockDb.seed(SCHEMA_TYPE.AGENT_WORK_MARKS, { scope: 'team-pack', key: 'apply', by: 'someone', rev: 1, until: new Date(Date.now() + 60000) });
        expect((await applyPack([project])).statusCode).toBe(409);
        expect(live()).toHaveLength(0);
        mark.until = new Date(Date.now() - 1000);
        expect((await applyPack([project])).statusCode).toBe(200);
        expect(live()).toHaveLength(engineering.length);
    });

    it('leaves agents out when asked, and a person\'s own agent for the role counts as the one', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: oid(), name: 'Mine', role: TRIAGER, projectIds: ids(project), deletedStatusKey: 0, ownerId: OWNER });
        const res = await call('POST', PACKS, { body: { blueprint: 'it-company', teams: ['engineering'], projectIds: ids(project), createAgents: false } });
        expect(res.body.data.agents).toEqual({ made: [], kept: [], widened: [] });
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
        const wide = await applyPack([two]);
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

    it('lets only an owner or admin create or remove agents through a pack, and turns a member\'s roles on without them', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        const asked = await call('POST', PACKS, { uid: EDITOR, body: { blueprint: 'it-company', teams: ['engineering'], projectIds: ids(project), createAgents: true } });
        expect(asked.statusCode).toBe(403);
        expect(asked.body.message).toContain('Only an Owner or an Admin can create or remove agents');
        expect(agentsOf()).toHaveLength(0);
        expect(store(SCHEMA_TYPE.ASSIGNMENT_RULES)).toHaveLength(0);
        const quiet = await applyPack([project], { uid: EDITOR });
        expect(quiet.statusCode).toBe(200);
        expect(quiet.body.data.agents).toEqual({ made: [], kept: [], widened: [] });
        expect(agentsOf()).toHaveLength(0);
        const made = await applyPack([project]);
        const undo = await call('POST', PACKS, { uid: EDITOR, body: { undo: true, blueprint: 'it-company', teams: ['engineering'], projectIds: ids(project), roles: {}, agents: made.body.data.agents.made.map((a) => a.agentId) } });
        expect(undo.statusCode).toBe(403);
        expect(live()).toHaveLength(engineering.length);
    });

    it('creates nothing for a member without project details, or an agent', async () => {
        seedRules({});
        const project = seedProject();
        expect((await applyPack([project], { uid: EDITOR })).statusCode).toBe(403);
        const token = { apiToken: { _id: oid(), kind: 'agent', userId: OWNER, name: 'Claude', scopes: ['read', 'write'] } };
        expect((await applyPack([project], { uid: OWNER, extra: token })).statusCode).toBe(403);
        expect(agentsOf()).toHaveLength(0);
    });

    describe('applies a pack whole or not at all', () => {
        const BUGS = [{ name: 'Task', value: 'task', key: 1 }, { name: 'Bug', value: 'bug', key: 4 }];
        const dispatcherOf = (project) => store(SCHEMA_TYPE.ASSIGNMENT_RULES).find((row) => String(row.projectId) === String(project._id))?.dispatcher;
        const full = (projects) => call('POST', PACKS, {
            body: { blueprint: 'it-company', teams: ['engineering'], projectIds: projects.map((project) => String(project._id)), starterRules: true, proposeTags: true, createAgents: true },
        });
        afterEach(() => {
            jest.restoreAllMocks();
            delete process.env.MCP_TOOLS_WORK;
        });

        it('takes back the settings, rules, tag approvals, skills, agents and widened projects it wrote when an agent fails, and says so', async () => {
            seedRules(GRANTS);
            process.env.MCP_TOOLS_WORK = 'on';
            const one = seedProject({ taskTypeCounts: BUGS });
            const two = seedProject({ taskTypeCounts: BUGS });
            const mine = oid();
            mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: mine, name: 'Mine', role: TRIAGER, projectIds: ids(one), deletedStatusKey: 0 });
            const agentRecord = require('../Modules/Agents/agentRecord');
            const real = agentRecord.createAgentRecord;
            let n = 0;
            jest.spyOn(agentRecord, 'createAgentRecord').mockImplementation(async (...args) => {
                n += 1;
                if (n === 3) throw new Error('disk full');
                return real(...args);
            });
            recordAudit.mockClear();
            const res = await full([one, two]);
            expect(res.statusCode).toBe(500);
            expect(res.body.message).toBe('The team pack could not be applied, so nothing was changed. Please try again.');
            expect(dispatcherOf(one)).toMatchObject({ roles: [], rules: [] });
            expect(dispatcherOf(two)).toMatchObject({ roles: [], rules: [] });
            expect(store(SCHEMA_TYPE.AGENT_PROPOSALS)).toHaveLength(2);
            expect(store(SCHEMA_TYPE.AGENT_PROPOSALS).every((row) => row.status !== 'pending')).toBe(true);
            expect(live().map((agent) => String(agent._id))).toEqual([mine]);
            expect(live()[0].projectIds.map(String)).toEqual(ids(one));
            expect(store(SCHEMA_TYPE.AGENT_SKILLS)).toEqual([]);
            expect(audited()).toEqual([]);
        });

        it('takes back the saved settings when the tag approval cannot be filed', async () => {
            seedRules(GRANTS);
            process.env.MCP_TOOLS_WORK = 'on';
            const project = seedProject({ taskTypeCounts: BUGS });
            jest.spyOn(require('../Modules/Agents/proposals'), 'create').mockRejectedValue(new Error('timeout'));
            const res = await full([project]);
            expect(res.statusCode).toBe(500);
            expect(res.body.message).toContain('nothing was changed');
            expect(dispatcherOf(project)).toMatchObject({ roles: [], rules: [] });
            expect(agentsOf()).toEqual([]);
        });

        it('names what it could not take back', async () => {
            seedRules(GRANTS);
            const project = seedProject();
            const settings = require('../Modules/AssignmentRules/dispatcher/settings');
            const save = settings.save;
            let saves = 0;
            jest.spyOn(settings, 'save').mockImplementation(async (...args) => {
                saves += 1;
                if (saves > 1) throw new Error('down');
                return save(...args);
            });
            jest.spyOn(require('../Modules/Agents/agentRecord'), 'createAgentRecord').mockRejectedValue(new Error('down'));
            const res = await full([project]);
            expect(res.statusCode).toBe(500);
            expect(res.body.message).toContain(`the dispatcher settings of project ${String(project._id)} could not be taken back`);
        });
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

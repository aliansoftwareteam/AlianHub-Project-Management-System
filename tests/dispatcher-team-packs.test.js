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

const NOTHING_ELSE = { modeWas: null, rules: [], skippedRules: 0, rulesAwaitingTags: 0, tags: [], proposalId: null };

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

const dispatcherOf = (project) => (mockDb.store[SCHEMA_TYPE.ASSIGNMENT_RULES] || []).find((row) => String(row.projectId) === String(project._id))?.dispatcher;
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
    delete process.env.MCP_TOOLS_WORK;
});

describe('team packs', () => {
    it('lists each blueprint\'s roles by team, with who each role is and its tools', async () => {
        const res = await call('GET', PACKS, { uid: VIEWER });
        expect(res.body.data.on).toBe(true);
        const it = res.body.data.packs.find((pack) => pack.blueprint === 'it-company');
        expect(it.teams.map((team) => team.team)).toEqual(expect.arrayContaining(['engineering', 'design', 'product', 'support', 'sales']));
        const triager = it.teams.find((team) => team.team === 'engineering').roles.find((role) => role.key === TRIAGER);
        expect(triager).toMatchObject({ name: 'Bug Triager', tools: expect.arrayContaining(['task.get']) });
        expect(triager.summary.length).toBeGreaterThan(20);
        expect(res.body.data.packs.find((pack) => pack.blueprint === 'manufacturing')).toBeTruthy();
    });

    it('turns the pack\'s roles on in every project, keeps a mode that is on and turns an off one to suggest, clears the cache, announces it and logs one row', async () => {
        seedRules(GRANTS);
        const live = seedProject();
        const quiet = seedProject();
        await call('PUT', SETTINGS, { params: { projectId: String(live._id) }, body: { mode: 'suggest', threshold: 80, roles: [DESIGN_LEAD], rules: [] } });
        recordAudit.mockClear();
        emitted = [];

        const res = await applyPack([live, quiet]);
        expect(res.statusCode).toBe(200);
        expect(res.body.data.projects).toEqual([
            { ...NOTHING_ELSE, projectId: String(live._id), added: engineering, mode: 'suggest' },
            { ...NOTHING_ELSE, projectId: String(quiet._id), added: engineering, mode: 'suggest', modeWas: 'off' },
        ]);
        expect(dispatcherOf(live)).toMatchObject({ mode: 'suggest', roles: [DESIGN_LEAD, ...engineering] });
        expect(dispatcherOf(quiet)).toMatchObject({ mode: 'suggest', roles: engineering });
        expect(removeCache).toHaveBeenCalledWith(`assignmentRules:${C}:${live._id}`);
        expect(emitted.filter((e) => e.module === 'dispatcherSettings' && e.companyId === C)).toHaveLength(2);
        expect(audited()).toEqual([expect.objectContaining({
            companyId: C, actorId: EDITOR, action: 'dispatcher.pack_applied', entityType: 'team_pack',
            meta: { blueprint: 'it-company', teams: ['engineering'], projects: [{ projectId: String(live._id), roles: engineering, rules: 0, tags: [] }, { projectId: String(quiet._id), roles: engineering, rules: 0, tags: [], mode: 'suggest' }], agents: { created: [], kept: [], widened: [] } },
        })]);
        expect(new Set(mockDb.calls.map((c) => c.companyId).filter((id) => id !== dbCollections.GLOBAL))).toEqual(new Set([C]));
    });

    it('adds nothing and logs nothing the second time', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await applyPack([project]);
        const revision = dispatcherOf(project).revision;
        recordAudit.mockClear();

        const again = await applyPack([project]);
        expect(again.body.data.projects).toEqual([{ ...NOTHING_ELSE, projectId: String(project._id), added: [], mode: 'suggest' }]);
        expect(dispatcherOf(project).revision).toBe(revision);
        expect(audited()).toEqual([]);
    });

    it('undoes by turning off only the roles the pack turned on', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await call('PUT', SETTINGS, { params: { projectId: String(project._id) }, body: { mode: 'apply', threshold: 80, roles: [DESIGN_LEAD, TRIAGER], rules: [] } });
        const applied = await applyPack([project]);
        const added = applied.body.data.projects[0].added;
        expect(added).not.toContain(TRIAGER);
        recordAudit.mockClear();

        const res = await call('POST', PACKS, { body: { undo: true, blueprint: 'it-company', teams: ['engineering'], projectIds: [String(project._id)], applyId: applied.body.data.applyId } });
        expect(res.body.data.projects).toEqual([{ projectId: String(project._id), removed: added, rules: [], mode: 'apply', modeRestored: null, tagsWithdrawn: false }]);
        expect(dispatcherOf(project)).toMatchObject({ mode: 'apply', roles: [DESIGN_LEAD, TRIAGER] });
        expect(audited()).toEqual([expect.objectContaining({ action: 'dispatcher.pack_undone', meta: expect.objectContaining({ projects: [{ projectId: String(project._id), roles: added, rules: 0 }] }) })]);
    });

    it('refuses an undo that leaves out a project the pack reached, or names no recorded pack', async () => {
        seedRules(GRANTS);
        const mine = seedProject();
        const other = seedProject({ AssigneeUserId: [OWNER] });
        const applied = await applyPack([mine, other], { uid: OWNER });
        const { applyId } = applied.body.data;
        const res = await call('POST', PACKS, { body: { undo: true, blueprint: 'it-company', teams: ['engineering'], projectIds: [String(mine._id)], applyId } });
        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBe('projectIds must name every project the pack was applied to.');
        expect(dispatcherOf(mine).roles).toEqual(engineering);
        expect((await call('POST', PACKS, { body: { undo: true, blueprint: 'it-company', teams: ['engineering'], projectIds: [String(mine._id)] } })).statusCode).toBe(400);
        expect((await call('POST', PACKS, { body: { undo: true, blueprint: 'it-company', teams: ['engineering'], projectIds: [String(mine._id)], applyId: oid() } })).statusCode).toBe(404);
    });

    it('refuses the whole pack when one project\'s details are not the caller\'s to change, and lets an admin through', async () => {
        seedRules(GRANTS);
        const open = seedProject();
        const closed = seedProject({ AssigneeUserId: [OWNER] });
        const res = await applyPack([open, closed]);
        expect([403, 404]).toContain(res.statusCode);
        expect(dispatcherOf(open)).toBeUndefined();

        const admin = await applyPack([open, closed], { uid: OWNER });
        expect(admin.statusCode).toBe(200);
        expect(dispatcherOf(closed).roles).toEqual(engineering);
    });

    it('writes no project when one project\'s new settings would not save, and names that project', async () => {
        seedRules(GRANTS);
        const good = seedProject();
        const broken = seedProject();
        mockDb.seed(SCHEMA_TYPE.ASSIGNMENT_RULES, { projectId: String(broken._id), entries: [], dispatcher: { mode: 'suggest', roles: [], rules: [{ role: 'it-company/nobody', when: { tags: ['x'] } }] } });
        recordAudit.mockClear();
        const res = await applyPack([good, broken]);
        expect(res.statusCode).toBe(400);
        expect(res.body.statusText).toContain(`Project ${broken._id}`);
        expect(dispatcherOf(good)).toBeUndefined();
        expect(dispatcherOf(broken).roles).toEqual([]);
        expect(audited()).toEqual([]);
    });

    it('undoes only the roles its own apply turned on, never one a client names, and refuses a pack that does not exist', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await call('PUT', SETTINGS, { params: { projectId: String(project._id) }, body: { mode: 'suggest', threshold: 80, roles: [TRIAGER], rules: [] } });
        const applied = await applyPack([project], { teams: ['design'] });
        recordAudit.mockClear();
        const id = String(project._id);
        const res = await call('POST', PACKS, { body: { undo: true, blueprint: 'it-company', teams: ['design'], projectIds: [id], applyId: applied.body.data.applyId, roles: { [id]: [TRIAGER] } } });
        expect(res.body.data.projects).toEqual([{ projectId: id, removed: applied.body.data.projects[0].added, rules: [], mode: 'suggest', modeRestored: null, tagsWithdrawn: false }]);
        expect(dispatcherOf(project).roles).toEqual([TRIAGER]);
        expect(audited()).toEqual([expect.objectContaining({ action: 'dispatcher.pack_undone', entityId: 'it-company', meta: expect.objectContaining({ blueprint: 'it-company', teams: ['design'] }) })]);

        recordAudit.mockClear();
        const again = await call('POST', PACKS, { body: { undo: true, blueprint: 'it-company', teams: ['design'], projectIds: [id], applyId: applied.body.data.applyId } });
        expect(again.statusCode).toBe(404);
        const unknown = await call('POST', PACKS, { body: { undo: true, blueprint: 'made-up', teams: ['design'], projectIds: [id], applyId: applied.body.data.applyId } });
        expect(unknown.statusCode).toBe(400);
        expect(dispatcherOf(project).roles).toEqual([TRIAGER]);
        expect(audited()).toEqual([]);
    });

    it('cleans the project list before the permission check: at most 50, no repeats, lower-case', async () => {
        seedRules(GRANTS);
        const many = Array.from({ length: 51 }, () => oid());
        const tooMany = await call('POST', PACKS, { body: { blueprint: 'it-company', teams: ['engineering'], projectIds: many } });
        expect(tooMany.statusCode).toBe(400);

        const project = seedProject();
        const id = String(project._id);
        const res = await call('POST', PACKS, { body: { blueprint: 'it-company', teams: ['engineering'], projectIds: [id.toUpperCase(), id] } });
        expect(res.statusCode).toBe(200);
        expect(res.body.data.projects.map((one) => one.projectId)).toEqual([id]);
        expect(store(SCHEMA_TYPE.ASSIGNMENT_RULES).map((row) => row.projectId)).toEqual([id]);
    });

    it('refuses a member whose role may not change project details', async () => {
        seedRules({ ...GRANTS, 'project.project_details': false });
        const project = seedProject();
        expect((await applyPack([project])).statusCode).toBe(403);
        expect(dispatcherOf(project)).toBeUndefined();
    });

    it('refuses an agent', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        const agentToken = { apiToken: { _id: oid(), kind: 'agent', userId: OWNER, name: 'Claude', scopes: ['read', 'write'] } };
        const res = await applyPack([project], { uid: OWNER, extra: agentToken });
        expect(res.statusCode).toBe(403);
        expect(dispatcherOf(project)).toBeUndefined();
    });

    it('says the dispatcher is off while it is off', async () => {
        seedRules(GRANTS);
        process.env.DISPATCHER = 'off';
        const project = seedProject();
        const res = await applyPack([project]);
        expect(res.statusCode).toBe(409);
        expect(res.body.statusText).toBe('The dispatcher is off on this server.');
        expect(dispatcherOf(project)).toBeUndefined();
        expect((await call('GET', PACKS, { uid: VIEWER })).body.data.on).toBe(false);
    });

    it('refuses an unknown blueprint or team and a bad project list', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        const ids = [String(project._id)];
        expect((await call('POST', PACKS, { body: { blueprint: 'bakery', teams: ['engineering'], projectIds: ids } })).statusCode).toBe(400);
        expect((await call('POST', PACKS, { body: { blueprint: 'it-company', teams: ['no-such-team'], projectIds: ids } })).statusCode).toBe(400);
        expect((await call('POST', PACKS, { body: { blueprint: 'it-company', teams: [], projectIds: ids } })).statusCode).toBe(400);
        expect((await call('POST', PACKS, { body: { blueprint: 'it-company', teams: ['engineering'], projectIds: ['nope'] } })).statusCode).toBe(400);
        expect(dispatcherOf(project)).toBeUndefined();
    });
    it('turns on only the roles named in only, for a company blueprint\'s first three, and turns only an off project to suggest', async () => {
        seedRules(GRANTS);
        const quiet = seedProject();
        const live = seedProject();
        await call('PUT', SETTINGS, { params: { projectId: String(live._id) }, body: { mode: 'suggest', threshold: 80, roles: [], rules: [] } });
        const first = ['it-company/bug-triager', 'it-company/support-agent', 'it-company/tech-lead'];
        const res = await call('POST', PACKS, { body: { blueprint: 'it-company', teams: ['engineering', 'support'], only: first, projectIds: [String(quiet._id), String(live._id)] } });
        expect(res.statusCode).toBe(200);
        res.body.data.projects.forEach((project) => {
            expect(project.added).toHaveLength(3);
            expect(project.added).toEqual(expect.arrayContaining(first));
        });
        expect(res.body.data.projects.map((project) => [project.mode, project.modeWas])).toEqual([['suggest', 'off'], ['suggest', null]]);
        expect(dispatcherOf(quiet).mode).toBe('suggest');
        expect(dispatcherOf(live).mode).toBe('suggest');
    });

    it('refuses an only role outside the chosen teams or an empty only, and writes nothing', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        const id = String(project._id);
        expect((await call('POST', PACKS, { body: { blueprint: 'it-company', teams: ['engineering'], only: [DESIGN_LEAD], projectIds: [id] } })).statusCode).toBe(400);
        expect((await call('POST', PACKS, { body: { blueprint: 'it-company', teams: ['engineering'], only: [], projectIds: [id] } })).statusCode).toBe(400);
        expect(dispatcherOf(project)).toBeUndefined();
    });

    it('lists the company blueprints beside the packs', async () => {
        const res = await call('GET', PACKS, { uid: VIEWER });
        const it = res.body.data.companyBlueprints.find((one) => one.id === 'it-company');
        expect(it.sizes.small.starter).toEqual(['Bug Triager', 'Support Agent', 'Tech Lead']);
    });
});

describe('team pack starter rules and tags', () => {
    const BUGS = [{ name: 'Task', value: 'task', key: 1 }, { name: 'Bug', value: 'bug', key: 4 }];
    const withStarter = (projects, extra = {}) => call('POST', PACKS, {
        body: { blueprint: 'it-company', teams: ['engineering'], projectIds: projects.map((project) => String(project._id)), starterRules: true, ...extra },
    });
    const pending = () => store(SCHEMA_TYPE.AGENT_PROPOSALS);
    const triagerRule = (key = 4) => ({ role: TRIAGER, when: { taskTypeKeys: [key] } });

    it('lists the starter rules and tags each role brings', async () => {
        const res = await call('GET', PACKS, { uid: VIEWER });
        const roles = res.body.data.packs.find((pack) => pack.blueprint === 'it-company').teams.find((team) => team.team === 'engineering').roles;
        expect(roles.find((role) => role.key === TRIAGER)).toMatchObject({ starterRules: [{ kind: 'type', value: 'Bug' }], tags: ['bug', 'needs-triage'] });
    });

    it('adds a starter rule with the project\'s own type key in the same save as the roles', async () => {
        seedRules(GRANTS);
        const project = seedProject({ taskTypeCounts: BUGS });
        const res = await withStarter([project]);
        expect(res.statusCode).toBe(200);
        expect(res.body.data.projects[0].rules).toEqual([{ id: expect.stringMatching(/^[a-f0-9]{24}$/), ...triagerRule() }]);
        expect(dispatcherOf(project)).toMatchObject({ roles: engineering, rules: [{ id: res.body.data.projects[0].rules[0].id, ...triagerRule() }], revision: 1 });
        expect(audited()[0].meta.projects).toEqual([{ projectId: String(project._id), roles: engineering, rules: 1, tags: [], mode: 'suggest' }]);
    });

    it('leaves the rules alone unless they are asked for', async () => {
        seedRules(GRANTS);
        const project = seedProject({ taskTypeCounts: BUGS });
        await applyPack([project]);
        expect(dispatcherOf(project).rules).toEqual([]);
    });

    it('never duplicates a rule the project has, and counts a rule it cannot place as skipped', async () => {
        seedRules(GRANTS);
        const project = seedProject({ taskTypeCounts: BUGS });
        const lacking = seedProject({ taskTypeCounts: [BUGS[0]] });
        mockDb.seed(SCHEMA_TYPE.ASSIGNMENT_RULES, { projectId: String(project._id), entries: [], dispatcher: { mode: 'suggest', roles: [], rules: [triagerRule()] } });
        const res = await withStarter([project, lacking]);
        const [held, missing] = res.body.data.projects;
        expect(held.rules).toEqual([]);
        expect(missing.rules).toEqual([]);
        expect(missing.skippedRules).toBe(held.skippedRules + 1);
        expect(dispatcherOf(project).rules).toEqual([triagerRule()]);
        expect(dispatcherOf(lacking).rules).toEqual([]);

        const again = await withStarter([project]);
        expect(again.body.data.projects[0]).toMatchObject({ added: [], rules: [] });
        expect(dispatcherOf(project).rules).toEqual([triagerRule()]);
    });

    it('writes a rule alone when every role is already on', async () => {
        seedRules(GRANTS);
        const project = seedProject({ taskTypeCounts: BUGS });
        await applyPack([project]);
        const revision = dispatcherOf(project).revision;
        const res = await withStarter([project]);
        expect(res.body.data.projects[0]).toMatchObject({ added: [], rules: [triagerRule()] });
        expect(dispatcherOf(project)).toMatchObject({ rules: [triagerRule()], revision: revision + 1 });
    });

    it('saves no project, and no rule, when one project\'s settings would not save', async () => {
        seedRules(GRANTS);
        const good = seedProject({ taskTypeCounts: BUGS });
        const broken = seedProject({ taskTypeCounts: BUGS });
        mockDb.seed(SCHEMA_TYPE.ASSIGNMENT_RULES, { projectId: String(broken._id), entries: [], dispatcher: { mode: 'suggest', roles: [], rules: [{ role: 'it-company/nobody', when: { tags: ['x'] } }] } });
        const res = await withStarter([good, broken], { proposeTags: true });
        expect(res.statusCode).toBe(400);
        expect(dispatcherOf(good)).toBeUndefined();
        expect(pending()).toEqual([]);
    });

    it('matches a tag rule by the project\'s tag id, once the project has the tag', async () => {
        seedRules(GRANTS);
        const project = seedProject({ taskTypeCounts: BUGS, tagsArray: [{ uid: 'abc', tagName: 'Support' }] });
        const res = await call('POST', PACKS, { body: { blueprint: 'it-company', teams: ['support'], projectIds: [String(project._id)], starterRules: true } });
        expect(res.body.data.projects[0].rules).toEqual([{ id: expect.any(String), role: 'it-company/support-lead', when: { tags: ['abc'] } }]);
    });

    it('counts a tag rule whose tag it proposed as waiting for the approval, and adds it on the next apply once the tag is there', async () => {
        seedRules(GRANTS);
        process.env.MCP_TOOLS_WORK = 'on';
        const project = seedProject({ taskTypeCounts: BUGS });
        const support = { blueprint: 'it-company', teams: ['support'], projectIds: [String(project._id)], starterRules: true, proposeTags: true };
        const first = await call('POST', PACKS, { body: support });
        expect(first.body.data.projects[0]).toMatchObject({ rules: [], skippedRules: 0, rulesAwaitingTags: 1, tags: expect.arrayContaining(['support']) });
        const again = await call('POST', PACKS, { body: support });
        expect(again.body.data.projects[0]).toMatchObject({ rules: [], rulesAwaitingTags: 1, proposalId: null });

        store(SCHEMA_TYPE.AGENT_PROPOSALS)[0].status = 'approved';
        store(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === String(project._id)).tagsArray = [{ uid: 'abc', tagName: 'support' }];
        const after = await call('POST', PACKS, { body: support });
        expect(after.body.data.projects[0]).toMatchObject({ rules: [{ role: 'it-company/support-lead', when: { tags: ['abc'] } }], rulesAwaitingTags: 0 });
    });

    it('still counts a tag rule as skipped when nobody proposed its tag', async () => {
        seedRules(GRANTS);
        const project = seedProject({ taskTypeCounts: BUGS });
        const res = await call('POST', PACKS, { body: { blueprint: 'it-company', teams: ['support'], projectIds: [String(project._id)], starterRules: true } });
        expect(res.body.data.projects[0]).toMatchObject({ rules: [], skippedRules: 1, rulesAwaitingTags: 0 });
    });

    it('undoes only the rules its apply recorded, by id, and keeps one a person changed or wrote alike', async () => {
        seedRules(GRANTS);
        const one = seedProject({ taskTypeCounts: BUGS });
        const two = seedProject({ taskTypeCounts: BUGS });
        const mine = { role: DESIGN_LEAD, when: { priorities: ['HIGH'] } };
        for (const project of [one, two]) await call('PUT', SETTINGS, { params: { projectId: String(project._id) }, body: { mode: 'suggest', threshold: 80, roles: [DESIGN_LEAD], rules: [mine] } });
        const applied = await withStarter([one, two]);
        const [first, second] = applied.body.data.projects;
        expect(first.rules).toEqual([{ id: expect.any(String), ...triagerRule() }]);
        const edited = { ...first.rules[0], when: { taskTypeKeys: [4], priorities: ['HIGH'] } };
        const alike = triagerRule();
        await call('PUT', SETTINGS, { params: { projectId: String(one._id) }, body: { mode: 'suggest', threshold: 80, roles: dispatcherOf(one).roles, rules: [mine, edited] } });
        await call('PUT', SETTINGS, { params: { projectId: String(two._id) }, body: { mode: 'suggest', threshold: 80, roles: dispatcherOf(two).roles, rules: [mine, ...second.rules, alike] } });

        const stray = { role: DESIGN_LEAD, when: { priorities: ['HIGH'] } };
        const projectIds = [String(one._id), String(two._id)];
        const res = await call('POST', PACKS, { body: { undo: true, blueprint: 'it-company', teams: ['engineering'], projectIds, applyId: applied.body.data.applyId, rules: { [projectIds[0]]: [stray, edited] } } });
        expect(res.body.data.projects[0]).toMatchObject({ removed: first.added, rules: [] });
        expect(res.body.data.projects[1]).toMatchObject({ removed: second.added, rules: second.rules });
        expect(dispatcherOf(one)).toMatchObject({ roles: [DESIGN_LEAD], rules: [mine, edited] });
        expect(dispatcherOf(two).rules).toEqual([mine, alike]);
    });

    it('proposes the missing tags as one tag.create approval per project and creates none', async () => {
        seedRules(GRANTS);
        process.env.MCP_TOOLS_WORK = 'on';
        const bare = seedProject({ taskTypeCounts: BUGS });
        const stocked = seedProject({ taskTypeCounts: BUGS, tagsArray: [{ uid: 't1', tagName: 'Bug' }] });
        const res = await withStarter([bare, stocked], { proposeTags: true });
        expect(res.statusCode).toBe(200);
        const [first, second] = res.body.data.projects;
        expect(first.tags).toEqual(expect.arrayContaining(['bug', 'needs-triage']));
        expect(second.tags).not.toContain('bug');
        expect(pending()).toHaveLength(2);
        const forBare = pending().find((row) => String(row.projectId) === String(bare._id));
        expect(String(forBare._id)).toBe(first.proposalId);
        expect(forBare).toMatchObject({ status: 'pending', source: 'system', allowedActions: ['tag.create'] });
        expect(forBare.changes.map((change) => change.action)).toEqual(first.tags.map(() => 'tag.create'));
        expect(forBare.changes.map((change) => change.params.name)).toEqual(first.tags);
        expect(store(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === String(bare._id)).tagsArray).toBeUndefined();
    });

    it('proposes nothing a second time while the first approval waits, and nothing without the option', async () => {
        seedRules(GRANTS);
        process.env.MCP_TOOLS_WORK = 'on';
        const project = seedProject({ taskTypeCounts: BUGS });
        await applyPack([project]);
        expect(pending()).toEqual([]);
        await withStarter([project], { proposeTags: true });
        const again = await withStarter([project], { proposeTags: true });
        expect(again.body.data.projects[0]).toMatchObject({ tags: [], proposalId: null });
        expect(pending()).toHaveLength(1);
    });

    it('proposes no tags where agents cannot add them', async () => {
        seedRules(GRANTS);
        process.env.MCP_TOOLS_WORK = 'off';
        const project = seedProject({ taskTypeCounts: BUGS });
        const res = await withStarter([project], { proposeTags: true });
        expect(res.body.data.projects[0]).toMatchObject({ tags: [], proposalId: null });
        expect(pending()).toEqual([]);
    });

    it('finds the pack\'s tag approval by the project id as it is stored, an ObjectId, when it checks for one and withdraws it', async () => {
        seedRules(GRANTS);
        process.env.MCP_TOOLS_WORK = 'on';
        const project = seedProject({ taskTypeCounts: BUGS });
        const id = String(project._id);
        const applied = await withStarter([project], { proposeTags: true });
        await withStarter([project], { proposeTags: true });
        const [row] = applied.body.data.projects;
        expect(row.proposalId).toBeTruthy();
        await call('POST', PACKS, { body: { undo: true, blueprint: 'it-company', teams: ['engineering'], projectIds: [id], applyId: applied.body.data.applyId } });
        const reads = mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.AGENT_PROPOSALS && ['find', 'findOne'].includes(c.method) && c.data[0].agentId === 'team-pack');
        expect(reads.length).toBeGreaterThanOrEqual(2);
        reads.forEach((c) => {
            expect(c.data[0].projectId.$in.map(String)).toEqual([id, id]);
            expect(c.data[0].projectId.$in.some((one) => one instanceof mongoose.Types.ObjectId)).toBe(true);
        });
    });

    it('withdraws a tag approval nobody has decided when the pack is undone', async () => {
        seedRules(GRANTS);
        process.env.MCP_TOOLS_WORK = 'on';
        const project = seedProject({ taskTypeCounts: BUGS });
        const id = String(project._id);
        const applied = await withStarter([project], { proposeTags: true });
        const [row] = applied.body.data.projects;
        const res = await call('POST', PACKS, { body: { undo: true, blueprint: 'it-company', teams: ['engineering'], projectIds: [id], applyId: applied.body.data.applyId } });
        expect(res.body.data.projects[0].tagsWithdrawn).toBe(true);
        expect(pending()[0].status).toBe('declined');
    });

    describe('when the pack\'s tags are approved', () => {
        const SUPPORT_LEAD = 'it-company/support-lead';
        const support = (project) => ({ blueprint: 'it-company', teams: ['support'], projectIds: [String(project._id)], starterRules: true, proposeTags: true });
        const approve = (proposalId) => require('../Modules/Agents/proposals').approve(C, proposalId, { decider: { kind: 'human', userId: OWNER, personName: 'Olive' }, isPrivileged: true });
        const packs = () => require('../Modules/AssignmentRules/dispatcher/packs');
        const supportRules = (project) => dispatcherOf(project).rules.filter((rule) => rule.role === SUPPORT_LEAD);
        const tagIdOf = (project, name) => (store(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === String(project._id)).tagsArray || [])
            .find((tag) => String(tag.tagName).toLowerCase() === name)?.uid;

        it('adds the waiting tag rule on approval, once, and the pack\'s undo takes it back', async () => {
            seedRules(GRANTS);
            process.env.MCP_TOOLS_WORK = 'on';
            const project = seedProject({ taskTypeCounts: BUGS });
            const applied = await call('POST', PACKS, { body: support(project) });
            const [row] = applied.body.data.projects;
            expect(row).toMatchObject({ rulesAwaitingTags: 1, proposalId: expect.any(String) });
            expect(supportRules(project)).toEqual([]);

            const decided = await approve(row.proposalId);
            expect(decided.error).toBeUndefined();
            const tag = tagIdOf(project, 'support');
            expect(tag).toBeDefined();
            expect(supportRules(project)).toEqual([{ id: expect.any(String), role: SUPPORT_LEAD, when: { tags: [String(tag)] } }]);
            expect(recordAudit.mock.calls.map(([, entry]) => entry)).toEqual(expect.arrayContaining([
                expect.objectContaining({ action: 'dispatcher.rule_added', actorId: OWNER, entityId: String(project._id) }),
            ]));

            expect(await packs().tagsApproved(C, row.proposalId, { id: OWNER })).toEqual([]);
            expect(supportRules(project)).toHaveLength(1);

            const added = supportRules(project);
            const undone = await call('POST', PACKS, { body: { undo: true, ...support(project), applyId: applied.body.data.applyId } });
            expect(undone.body.data.projects[0].rules).toEqual(expect.arrayContaining(added));
            expect(supportRules(project)).toEqual([]);
        });

        it('adds nothing for an approval in another company, or for a proposal that is not the pack\'s', async () => {
            seedRules(GRANTS);
            process.env.MCP_TOOLS_WORK = 'on';
            const project = seedProject({ taskTypeCounts: BUGS });
            const applied = await call('POST', PACKS, { body: support(project) });
            const { proposalId } = applied.body.data.projects[0];
            const proposal = store(SCHEMA_TYPE.AGENT_PROPOSALS).find((one) => String(one._id) === proposalId);
            proposal.status = 'approved';
            store(SCHEMA_TYPE.PROJECTS).find((one) => String(one._id) === String(project._id)).tagsArray = [{ uid: 'abc', tagName: 'support' }];

            const home = mockDb;
            const elsewhere = fakeMongo.create();
            mockDb = { ...home, crud: (companyId, ...rest) => (companyId === C ? home : elsewhere).crud(companyId, ...rest) };
            expect(await packs().tagsApproved('c00000000000000000000009', proposalId, { id: OWNER })).toEqual([]);
            mockDb = home;
            expect(supportRules(project)).toEqual([]);
            proposal.agentId = 'someone-else';
            expect(await packs().tagsApproved(C, proposalId, { id: OWNER })).toEqual([]);
            expect(supportRules(project)).toEqual([]);
            proposal.agentId = 'team-pack';
            expect(await packs().tagsApproved(C, proposalId, { id: OWNER })).toEqual([{ id: expect.any(String), role: SUPPORT_LEAD, when: { tags: ['abc'] } }]);
        });

        const packsOf = (project) => (store(SCHEMA_TYPE.ASSIGNMENT_RULES).find((row) => String(row.projectId) === String(project._id)) || {}).teamPacks || [];
        const setTag = (project, tagsArray = [{ uid: 'abc', tagName: 'support' }]) => { store(SCHEMA_TYPE.PROJECTS).find((one) => String(one._id) === String(project._id)).tagsArray = tagsArray; };
        const proposalRow = (proposalId) => store(SCHEMA_TYPE.AGENT_PROPOSALS).find((one) => String(one._id) === proposalId);

        it('adds the rule while a pack change holds the lock, without waiting for it', async () => {
            seedRules(GRANTS);
            process.env.MCP_TOOLS_WORK = 'on';
            const project = seedProject({ taskTypeCounts: BUGS });
            const { proposalId } = (await call('POST', PACKS, { body: support(project) })).body.data.projects[0];
            proposalRow(proposalId).status = 'approved';
            setTag(project);
            const { withPackLock } = require('../Modules/AssignmentRules/dispatcher/packLock');
            const made = await withPackLock(C, () => packs().tagsApproved(C, proposalId, { id: OWNER }));
            expect(made).toEqual([{ id: expect.any(String), role: SUPPORT_LEAD, when: { tags: ['abc'] } }]);
            expect(supportRules(project)).toEqual(made);
            expect(recordAudit.mock.calls.map(([, entry]) => entry).find((entry) => entry.action === 'dispatcher.rule_added').meta)
                .toEqual({ teamPackTags: proposalId, rules: 1, applies: [{ applyId: packsOf(project)[0].applyId, appliedBy: EDITOR }] });
        });

        it('records the waiting rule of a second apply that asks for starter rules after the first proposed the tags', async () => {
            seedRules(GRANTS);
            process.env.MCP_TOOLS_WORK = 'on';
            const project = seedProject({ taskTypeCounts: BUGS });
            const first = await call('POST', PACKS, { body: { ...support(project), starterRules: false } });
            const { proposalId } = first.body.data.projects[0];
            expect(proposalId).toBeTruthy();
            const second = await call('POST', PACKS, { body: support(project) });
            expect(second.body.data.projects[0]).toMatchObject({ rules: [], rulesAwaitingTags: 1, proposalId: null });
            expect(second.body.data.applyId).toBeTruthy();

            await approve(proposalId);
            expect(supportRules(project)).toEqual([{ id: expect.any(String), role: SUPPORT_LEAD, when: { tags: [String(tagIdOf(project, 'support'))] } }]);
        });

        it('keeps a rule waiting through a partial approval and adds it when the part left for later is approved', async () => {
            seedRules(GRANTS);
            process.env.MCP_TOOLS_WORK = 'on';
            const project = seedProject({ taskTypeCounts: BUGS });
            const { proposalId } = (await call('POST', PACKS, { body: support(project) })).body.data.projects[0];
            proposalRow(proposalId).status = 'edited';
            setTag(project, [{ uid: 'xyz', tagName: 'something-else' }]);
            expect(await packs().tagsApproved(C, proposalId, { id: OWNER })).toEqual([]);
            expect(packsOf(project)[0].waitingRules).toHaveLength(1);

            const split = mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, { projectId: String(project._id), agentId: 'team-pack', status: 'approved', splitFrom: proposalId, changes: [] });
            setTag(project);
            expect(await packs().tagsApproved(C, String(split._id), { id: OWNER })).toEqual([{ id: expect.any(String), role: SUPPORT_LEAD, when: { tags: ['abc'] } }]);
            expect(packsOf(project)[0].waitingRules).toEqual([]);
            expect(await packs().tagsApproved(C, String(split._id), { id: OWNER })).toEqual([]);
        });

        it('stops waiting on a tag approval an undo withdrew', async () => {
            seedRules(GRANTS);
            process.env.MCP_TOOLS_WORK = 'on';
            const project = seedProject({ taskTypeCounts: BUGS });
            const first = await call('POST', PACKS, { body: support(project) });
            await call('POST', PACKS, { body: support(project) });
            expect(packsOf(project).map((entry) => entry.waitingRules.length)).toEqual([1, 1]);
            await call('POST', PACKS, { body: { undo: true, ...support(project), applyId: first.body.data.applyId } });
            expect(packsOf(project).map((entry) => entry.waitingRules)).toEqual([[]]);
        });

        it('adds no rule for a role a person has turned off since the apply', async () => {
            seedRules(GRANTS);
            process.env.MCP_TOOLS_WORK = 'on';
            const project = seedProject({ taskTypeCounts: BUGS });
            const applied = await call('POST', PACKS, { body: support(project) });
            const current = dispatcherOf(project);
            await call('PUT', SETTINGS, { params: { projectId: String(project._id) }, body: { mode: current.mode, threshold: 80, roles: current.roles.filter((key) => key !== SUPPORT_LEAD), rules: current.rules } });
            await approve(applied.body.data.projects[0].proposalId);
            expect(supportRules(project)).toEqual([]);
        });
    });

    describe('the project\'s dispatcher mode', () => {
        const idOf = (project) => String(project._id);
        const undoOf = (project, applied) => call('POST', PACKS, { body: { undo: true, blueprint: 'it-company', teams: ['engineering'], projectIds: [idOf(project)], applyId: applied.body.data.applyId } });

        it('switches an off dispatcher to suggest and the undo turns it off again', async () => {
            seedRules(GRANTS);
            const project = seedProject();
            const applied = await applyPack([project]);
            expect(applied.body.data.projects[0]).toMatchObject({ mode: 'suggest', modeWas: 'off' });
            expect(dispatcherOf(project).mode).toBe('suggest');
            const undone = await undoOf(project, applied);
            expect(undone.body.data.projects[0]).toMatchObject({ mode: 'off', modeRestored: 'off' });
            expect(dispatcherOf(project).mode).toBe('off');
        });

        it('keeps suggesting while a later pack remains, and turns off when the last is undone', async () => {
            seedRules(GRANTS);
            const project = seedProject();
            const first = await applyPack([project]);
            const second = await applyPack([project], { teams: ['design'] });
            expect(second.body.data.projects[0]).toMatchObject({ mode: 'suggest', modeWas: null });

            const undoneFirst = await undoOf(project, first);
            expect(undoneFirst.body.data.projects[0]).toMatchObject({ mode: 'suggest', modeRestored: null });
            expect(dispatcherOf(project).mode).toBe('suggest');

            const undoneSecond = await call('POST', PACKS, { body: { undo: true, blueprint: 'it-company', teams: ['design'], projectIds: [idOf(project)], applyId: second.body.data.applyId } });
            expect(undoneSecond.body.data.projects[0]).toMatchObject({ mode: 'off', modeRestored: 'off' });
            expect(dispatcherOf(project).mode).toBe('off');
        });

        it('never turns on auto-assign, and leaves a mode a person changed after the apply', async () => {
            seedRules(GRANTS);
            const auto = seedProject();
            await call('PUT', SETTINGS, { params: { projectId: idOf(auto) }, body: { mode: 'apply', threshold: 80, roles: [], rules: [] } });
            const kept = await applyPack([auto]);
            expect(kept.body.data.projects[0]).toMatchObject({ mode: 'apply', modeWas: null });

            const project = seedProject();
            const applied = await applyPack([project]);
            const now = dispatcherOf(project);
            await call('PUT', SETTINGS, { params: { projectId: idOf(project) }, body: { mode: 'apply', threshold: 80, roles: now.roles, rules: now.rules } });
            const undone = await undoOf(project, applied);
            expect(undone.body.data.projects[0]).toMatchObject({ mode: 'apply', modeRestored: null });
            expect(dispatcherOf(project).mode).toBe('apply');
        });
    });
});

describe('team pack writes that interleave', () => {
    const BUGS = [{ name: 'Task', value: 'task', key: 1 }, { name: 'Bug', value: 'bug', key: 4 }];
    const SUPPORT_LEAD = 'it-company/support-lead';
    const packs = () => require('../Modules/AssignmentRules/dispatcher/packs');
    const body = (project, teams, extra = {}) => ({ blueprint: 'it-company', teams, projectIds: [String(project._id)], starterRules: true, ...extra });
    const rowOf = (project) => store(SCHEMA_TYPE.ASSIGNMENT_RULES).find((row) => String(row.projectId) === String(project._id));
    const projectRow = (project) => store(SCHEMA_TYPE.PROJECTS).find((one) => String(one._id) === String(project._id));
    const settingsWrite = (companyId, { type, data }, method) => type === SCHEMA_TYPE.ASSIGNMENT_RULES && method === 'updateOne' && Boolean(data[1] && data[1].$set && data[1].$set.dispatcher);
    const recordWrite = (companyId, { type, data }, method) => type === SCHEMA_TYPE.ASSIGNMENT_RULES && method === 'updateOne' && Boolean(data[1] && data[1].$push && data[1].$push['teamPacks.$[pack].rules']);
    const tagRule = (project, role, name) => ({ id: expect.any(String), role, when: { tags: [String(projectRow(project).tagsArray.find((tag) => tag.tagName === name).uid)] } });

    /* Runs `hook` once, just before the first database call `when` picks, so it lands between another write's read and its save. */
    const interleave = (when, hook, { every = false } = {}) => {
        const crud = mockDb.crud;
        let fired = false;
        let inHook = false;
        mockDb.crud = async (...args) => {
            if (!inHook && (every || !fired) && when(...args)) {
                fired = true;
                inHook = true;
                try { await hook(); } finally { inHook = false; }
            }
            return crud(...args);
        };
        return () => { mockDb.crud = crud; };
    };

    const withApprovedSupportTag = async (project) => {
        const applied = await call('POST', PACKS, { body: body(project, ['support'], { proposeTags: true }) });
        const { proposalId } = applied.body.data.projects[0];
        store(SCHEMA_TYPE.AGENT_PROPOSALS).find((one) => String(one._id) === proposalId).status = 'approved';
        projectRow(project).tagsArray = [{ uid: 'tag-support', tagName: 'support' }];
        return { applied, proposalId };
    };

    beforeEach(() => {
        seedRules(GRANTS);
        process.env.MCP_TOOLS_WORK = 'on';
    });

    it('keeps both the approval\'s rule and the apply\'s rules when the approval lands between the apply\'s read and its save', async () => {
        const project = seedProject({ taskTypeCounts: BUGS });
        const { proposalId } = await withApprovedSupportTag(project);
        let activated;
        const restore = interleave(settingsWrite, async () => { activated = await packs().tagsApproved(C, proposalId, { id: OWNER }); });
        const res = await call('POST', PACKS, { body: body(project, ['engineering']) });
        restore();
        expect(res.statusCode).toBe(200);
        expect(activated).toEqual([tagRule(project, SUPPORT_LEAD, 'support')]);
        const { roles, rules } = dispatcherOf(project);
        expect(roles).toEqual(expect.arrayContaining([...engineering, SUPPORT_LEAD]));
        expect(rules).toEqual(expect.arrayContaining([...activated, ...res.body.data.projects[0].rules]));
        expect(res.body.data.projects[0].rules).toEqual([{ id: expect.any(String), role: TRIAGER, when: { taskTypeKeys: [4] } }]);
    });

    it('keeps the approval\'s rule when an undo of another apply runs between its read and its save', async () => {
        const project = seedProject({ taskTypeCounts: BUGS });
        const { proposalId } = await withApprovedSupportTag(project);
        const other = await call('POST', PACKS, { body: body(project, ['engineering']) });
        const restore = interleave(settingsWrite, () => call('POST', PACKS, { body: { undo: true, ...body(project, ['engineering']), applyId: other.body.data.applyId } }));
        const activated = await packs().tagsApproved(C, proposalId, { id: OWNER });
        restore();
        expect(activated).toHaveLength(1);
        const { roles, rules } = dispatcherOf(project);
        expect(rules).toEqual(activated);
        expect(roles).toContain(SUPPORT_LEAD);
        expect(roles.filter((key) => engineering.includes(key))).toEqual([]);
    });

    it('keeps both rules when the approval and its split-off part are decided at once, each once', async () => {
        const project = seedProject({ taskTypeCounts: BUGS });
        const applied = await call('POST', PACKS, { body: body(project, ['engineering'], { proposeTags: true }) });
        const { proposalId } = applied.body.data.projects[0];
        store(SCHEMA_TYPE.AGENT_PROPOSALS).find((one) => String(one._id) === proposalId).status = 'edited';
        const split = mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, { projectId: String(project._id), agentId: 'team-pack', status: 'approved', splitFrom: proposalId, changes: [] });
        projectRow(project).tagsArray = [{ uid: 'tag-review', tagName: 'needs-review' }];
        let fromSplit;
        const restore = interleave(settingsWrite, async () => {
            projectRow(project).tagsArray = [...projectRow(project).tagsArray, { uid: 'tag-incident', tagName: 'incident' }];
            fromSplit = await packs().tagsApproved(C, String(split._id), { id: OWNER });
        });
        const fromParent = await packs().tagsApproved(C, proposalId, { id: OWNER });
        restore();
        const tagRules = dispatcherOf(project).rules.filter((rule) => rule.when.tags);
        expect(tagRules).toEqual(expect.arrayContaining([
            tagRule(project, 'it-company/code-reviewer', 'needs-review'),
            tagRule(project, 'it-company/incident-scribe', 'incident'),
        ]));
        expect(tagRules).toHaveLength(2);
        expect([...fromSplit, ...fromParent]).toHaveLength(2);
        const entry = rowOf(project).teamPacks[0];
        expect(entry.rules.filter((rule) => rule.when.tags)).toHaveLength(2);
        expect(entry.waitingRules.map((rule) => rule.tag)).toEqual(['release']);
    });

    it('takes the rule back out when its apply is undone between the save and the record', async () => {
        const project = seedProject({ taskTypeCounts: BUGS });
        const { proposalId } = await withApprovedSupportTag(project);
        const restore = interleave(recordWrite, async () => { rowOf(project).teamPacks = []; });
        const activated = await packs().tagsApproved(C, proposalId, { id: OWNER });
        restore();
        expect(activated).toEqual([]);
        expect(dispatcherOf(project).rules.filter((rule) => rule.role === SUPPORT_LEAD)).toEqual([]);
    });

    it('removes a rule an approval recorded on the apply after the undo read it', async () => {
        const project = seedProject({ taskTypeCounts: BUGS });
        const { applied, proposalId } = await withApprovedSupportTag(project);
        let activated;
        const restore = interleave(settingsWrite, async () => { activated = await packs().tagsApproved(C, proposalId, { id: OWNER }); });
        const res = await call('POST', PACKS, { body: { undo: true, ...body(project, ['support'], { proposeTags: true }), applyId: applied.body.data.applyId } });
        restore();
        expect(activated).toHaveLength(1);
        expect(res.body.data.projects[0].rules).toEqual(activated);
        expect(dispatcherOf(project).rules).toEqual([]);
        expect(rowOf(project).teamPacks).toEqual([]);
    });

    it('gives two saves without a revision two different revisions', async () => {
        const project = seedProject();
        const id = String(project._id);
        await call('PUT', SETTINGS, { params: { projectId: id }, body: { mode: 'suggest', threshold: 80, roles: [], rules: [] } });
        const settings = require('../Modules/AssignmentRules/dispatcher/settings');
        let inner;
        const restore = interleave(settingsWrite, async () => { inner = await settings.save(C, id, { mode: 'apply', roles: [], rules: [] }, OWNER); });
        const outer = await settings.save(C, id, { mode: 'off', roles: [], rules: [] }, OWNER);
        restore();
        expect(inner.revision).toBe(2);
        expect(outer.revision).toBe(3);
        expect(dispatcherOf(project)).toMatchObject({ mode: 'off', revision: 3 });
    });

    it('leaves the waits when the rules cannot be saved, so a later approval still adds them', async () => {
        const project = seedProject({ taskTypeCounts: BUGS });
        const { proposalId } = await withApprovedSupportTag(project);
        const settings = require('../Modules/AssignmentRules/dispatcher/settings');
        const spy = jest.spyOn(settings, 'saveMerged').mockRejectedValueOnce(new Error('rules must be a list of at most 50 rules.'));
        await expect(packs().tagsApproved(C, proposalId, { id: OWNER })).rejects.toThrow('at most 50');
        spy.mockRestore();
        expect(rowOf(project).teamPacks[0].waitingRules).toHaveLength(1);
        expect(await packs().tagsApproved(C, proposalId, { id: OWNER })).toHaveLength(1);
    });

    it('answers 409 and takes back what it wrote when the settings keep changing under an apply', async () => {
        const one = seedProject();
        const two = seedProject();
        for (const project of [one, two]) await call('PUT', SETTINGS, { params: { projectId: String(project._id) }, body: { mode: 'off', threshold: 80, roles: [], rules: [] } });
        const restore = interleave((companyId, sent, method) => settingsWrite(companyId, sent, method) && sent.data[0]['dispatcher.revision'] !== undefined && String(sent.data[0].projectId) === String(two._id), async () => {
            rowOf(two).dispatcher.revision += 1;
        }, { every: true });
        const res = await call('POST', PACKS, { body: { blueprint: 'it-company', teams: ['engineering'], projectIds: [String(one._id), String(two._id)] } });
        restore();
        expect(res.statusCode).toBe(409);
        expect(res.body.reason).toBe('settings_changed');
        expect(dispatcherOf(one)).toMatchObject({ mode: 'off', roles: [] });
        expect(dispatcherOf(two)).toMatchObject({ mode: 'off', roles: [] });
        expect(rowOf(one).teamPacks || []).toEqual([]);
    });

    it('turns routing off only after the last pack is undone, whichever is undone first', async () => {
        const project = seedProject();
        const first = await applyPack([project]);
        const second = await applyPack([project], { teams: ['design'] });
        const undoOf = (applied, teams) => call('POST', PACKS, { body: { undo: true, blueprint: 'it-company', teams, projectIds: [String(project._id)], applyId: applied.body.data.applyId } });
        expect((await undoOf(second, ['design'])).body.data.projects[0]).toMatchObject({ mode: 'suggest', modeRestored: null });
        expect((await undoOf(first, ['engineering'])).body.data.projects[0]).toMatchObject({ mode: 'off', modeRestored: 'off' });
        expect(dispatcherOf(project).mode).toBe('off');
    });

    it('refuses a person\'s save made on settings that changed since they were read', async () => {
        const project = seedProject();
        const id = String(project._id);
        await call('PUT', SETTINGS, { params: { projectId: id }, body: { mode: 'suggest', threshold: 80, roles: [], rules: [] } });
        const { revision } = dispatcherOf(project);
        await applyPack([project]);
        const stale = await call('PUT', SETTINGS, { params: { projectId: id }, body: { mode: 'apply', threshold: 80, roles: [], rules: [], revision } });
        expect(stale.statusCode).toBe(409);
        expect(stale.body.reason).toBe('settings_changed');
        expect(dispatcherOf(project).roles).toEqual(engineering);
        const fresh = await call('PUT', SETTINGS, { params: { projectId: id }, body: { mode: 'apply', threshold: 80, roles: engineering, rules: [], revision: dispatcherOf(project).revision } });
        expect(fresh.statusCode).toBe(200);
    });
});

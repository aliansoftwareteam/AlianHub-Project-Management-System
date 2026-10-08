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

    it('turns the pack\'s roles on in every project, keeps the mode, clears the cache, announces it and logs one row', async () => {
        seedRules(GRANTS);
        const live = seedProject();
        const quiet = seedProject();
        await call('PUT', SETTINGS, { params: { projectId: String(live._id) }, body: { mode: 'suggest', threshold: 80, roles: [DESIGN_LEAD], rules: [] } });
        recordAudit.mockClear();
        emitted = [];

        const res = await applyPack([live, quiet]);
        expect(res.statusCode).toBe(200);
        expect(res.body.data.projects).toEqual([
            { projectId: String(live._id), added: engineering, mode: 'suggest' },
            { projectId: String(quiet._id), added: engineering, mode: 'off' },
        ]);
        expect(dispatcherOf(live)).toMatchObject({ mode: 'suggest', roles: [DESIGN_LEAD, ...engineering] });
        expect(dispatcherOf(quiet)).toMatchObject({ mode: 'off', roles: engineering });
        expect(removeCache).toHaveBeenCalledWith(`assignmentRules:${C}:${live._id}`);
        expect(emitted.filter((e) => e.module === 'dispatcherSettings' && e.companyId === C)).toHaveLength(2);
        expect(audited()).toEqual([expect.objectContaining({
            companyId: C, actorId: EDITOR, action: 'dispatcher.pack_applied', entityType: 'team_pack',
            meta: { blueprint: 'it-company', teams: ['engineering'], projects: [{ projectId: String(live._id), roles: engineering }, { projectId: String(quiet._id), roles: engineering }] },
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
        expect(again.body.data.projects).toEqual([{ projectId: String(project._id), added: [], mode: 'off' }]);
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

        const res = await call('POST', PACKS, { body: { undo: true, blueprint: 'it-company', teams: ['engineering'], projectIds: [String(project._id)], roles: { [String(project._id)]: added } } });
        expect(res.body.data.projects).toEqual([{ projectId: String(project._id), removed: added, mode: 'apply' }]);
        expect(dispatcherOf(project)).toMatchObject({ mode: 'apply', roles: [DESIGN_LEAD, TRIAGER] });
        expect(audited()).toEqual([expect.objectContaining({ action: 'dispatcher.pack_undone', meta: expect.objectContaining({ projects: [{ projectId: String(project._id), roles: added }] }) })]);
    });

    it('refuses an undo that names a project it was not checked for', async () => {
        seedRules(GRANTS);
        const mine = seedProject();
        const other = seedProject({ AssigneeUserId: [OWNER] });
        const res = await call('POST', PACKS, { body: { undo: true, blueprint: 'it-company', teams: ['engineering'], projectIds: [String(mine._id)], roles: { [String(other._id)]: [TRIAGER] } } });
        expect(res.statusCode).toBe(400);
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

    it('undoes only roles of the named pack, and refuses a pack that does not exist', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await call('PUT', SETTINGS, { params: { projectId: String(project._id) }, body: { mode: 'suggest', threshold: 80, roles: [DESIGN_LEAD, TRIAGER], rules: [] } });
        recordAudit.mockClear();
        const id = String(project._id);
        const res = await call('POST', PACKS, { body: { undo: true, blueprint: 'it-company', teams: ['design'], projectIds: [id], roles: { [id]: [DESIGN_LEAD, TRIAGER] } } });
        expect(res.body.data.projects).toEqual([{ projectId: id, removed: [DESIGN_LEAD], mode: 'suggest' }]);
        expect(dispatcherOf(project).roles).toEqual([TRIAGER]);
        expect(audited()).toEqual([expect.objectContaining({ action: 'dispatcher.pack_undone', entityId: 'it-company', meta: expect.objectContaining({ blueprint: 'it-company', teams: ['design'] }) })]);

        recordAudit.mockClear();
        const unknown = await call('POST', PACKS, { body: { undo: true, blueprint: 'made-up', teams: ['design'], projectIds: [id], roles: { [id]: [TRIAGER] } } });
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
        expect((await call('POST', PACKS, { body: { blueprint: 'it-company', teams: ['finance'], projectIds: ids } })).statusCode).toBe(400);
        expect((await call('POST', PACKS, { body: { blueprint: 'it-company', teams: [], projectIds: ids } })).statusCode).toBe(400);
        expect((await call('POST', PACKS, { body: { blueprint: 'it-company', teams: ['engineering'], projectIds: ['nope'] } })).statusCode).toBe(400);
        expect(dispatcherOf(project)).toBeUndefined();
    });
});

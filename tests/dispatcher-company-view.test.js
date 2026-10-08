const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn(), recordAuditFromReq: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const MEMBER = 'a00000000000000000000002';
const OUTSIDER = 'a00000000000000000000003';
const MEMBER_ROLE = 3;
const TRIAGER = 'it-company/bug-triager';
const REVIEWER = 'it-company/code-reviewer';
const DAY_MS = 24 * 60 * 60 * 1000;

const ORG_ROUTE = '/api/v2/assignment-rules/dispatcher/company/org-chart';
const FLOW_ROUTE = '/api/v2/assignment-rules/dispatcher/company/flow-board';

const oid = () => new mongoose.Types.ObjectId().toString();

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

const call = async (path, uid = MEMBER) => {
    const handlers = routes()[`GET ${path}`];
    const res = response();
    const req = verified({ uid, method: 'GET', originalUrl: path, params: {}, body: {}, query: {}, headers: { companyid: C } });
    for (const handler of handlers) {
        let advanced = false;
        // eslint-disable-next-line no-await-in-loop
        await handler(req, res, () => { advanced = true; });
        if (!advanced) break;
    }
    return res;
};

const seedGrants = () => {
    const parents = {};
    const parentOf = (section) => {
        if (!parents[section]) parents[section] = mockDb.seed(SCHEMA_TYPE.RULES, { key: section, isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }] });
        return parents[section];
    };
    Object.entries({ 'project.private_projects': 1, 'task.task_list': true }).forEach(([path, permission]) => {
        const [section, key] = path.split('.');
        mockDb.seed(SCHEMA_TYPE.RULES, { key, isParent: false, parentId: String(parentOf(section)._id), roles: [{ key: MEMBER_ROLE, permission }] });
    });
};

const seedProject = (name, assignees = [OWNER, MEMBER], dispatcher = {}) => {
    const project = mockDb.seed(SCHEMA_TYPE.PROJECTS, {
        _id: oid(), ProjectName: name, CompanyId: C, isPrivateSpace: true, AssigneeUserId: assignees, isGlobalPermission: true,
    });
    mockDb.seed(SCHEMA_TYPE.ASSIGNMENT_RULES, {
        projectId: String(project._id), entries: [], revision: 1,
        dispatcher: { mode: 'suggest', threshold: 80, roles: [TRIAGER, REVIEWER], rules: [], revision: 1, updatedBy: OWNER, ...dispatcher },
    });
    return project;
};

const seedTask = (project, doc = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    _id: oid(), ProjectID: String(project._id), CompanyId: C, TaskName: 'A task', TaskKey: 'T-1', statusType: 'default_active',
    deletedStatusKey: 0, isParentTask: true, AssigneeUserId: [], createdAt: new Date(), updatedAt: new Date(), ...doc,
});

const seedQueue = (project, task, role, more = {}) => mockDb.seed(SCHEMA_TYPE.PROJECT_FINDINGS, {
    projectId: String(project._id), rule: 'handed_over', status: 'open', key: `handed_over:${task._id}`, taskId: String(task._id), taskIds: [String(task._id)],
    facts: { role }, openedAt: new Date(), ...more,
});

const seedDecision = (project, task, more = {}) => mockDb.seed(SCHEMA_TYPE.DISPATCH_DECISIONS, {
    taskId: String(task._id), projectId: String(project._id), state: 'suggested', role: TRIAGER, source: 'rule', createdAt: new Date(), ...more,
});

const rolesOf = (data) => data.blueprints.flatMap((blueprint) => blueprint.teams.flatMap((team) => team.roles));
const laneOf = (data, key) => data.roles.find((entry) => entry.key === key);

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    mockDb.seed(dbCollections.COMPANIES, { _id: C });
    [[OWNER, 1], [MEMBER, MEMBER_ROLE], [OUTSIDER, MEMBER_ROLE]].forEach(([userId, roleType]) => {
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
    });
    [[OWNER, 'Olive'], [MEMBER, 'Mia'], [OUTSIDER, 'Otto']].forEach(([_id, Employee_Name]) => mockDb.seed(SCHEMA_TYPE.USERS, { _id, Employee_Name }));
    seedGrants();
    process.env.PERMISSION_ENFORCEMENT_MODE = 'enforce';
    process.env.DISPATCHER = 'on';
});

afterEach(() => {
    delete process.env.PERMISSION_ENFORCEMENT_MODE;
    delete process.env.DISPATCHER;
});

describe('company view: org chart', () => {
    it('groups the roles switched on by blueprint and team, with their agents and who supervises them', async () => {
        const project = seedProject('Launch');
        mockDb.seed(SCHEMA_TYPE.AGENTS, { name: 'Triage A', role: TRIAGER, ownerId: OWNER, paused: true, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.AGENTS, { name: 'Removed', role: TRIAGER, ownerId: MEMBER, deletedStatusKey: 1 });
        mockDb.seed(SCHEMA_TYPE.AGENTS, { name: 'Off role', role: 'it-company/release-manager', ownerId: MEMBER, deletedStatusKey: 0 });

        const res = await call(ORG_ROUTE);
        expect(res.body.data.on).toBe(true);
        const roles = rolesOf(res.body.data);
        expect(roles.map((role) => role.key).sort()).toEqual([TRIAGER, REVIEWER]);
        const triager = roles.find((role) => role.key === TRIAGER);
        expect(triager.projects).toEqual([{ id: String(project._id), name: 'Launch', mode: 'suggest' }]);
        expect(triager.agents).toEqual([expect.objectContaining({ name: 'Triage A', paused: true })]);
        expect(triager.supervisors).toEqual([{ id: OWNER, name: 'Olive', via: 'agent' }]);
        const reviewer = roles.find((role) => role.key === REVIEWER);
        expect(reviewer.agents).toEqual([]);
        expect(reviewer.supervisors).toEqual([{ id: OWNER, name: 'Olive', via: 'settings' }]);
        expect(res.body.data.blueprints[0].blueprint).toBe('it-company');
    });

    it('leaves out a project the person cannot open, a project with the dispatcher off, and the agents only there', async () => {
        seedProject('Secret', [OWNER], { roles: [TRIAGER] });
        seedProject('Quiet', [OWNER, OUTSIDER], { mode: 'off' });
        mockDb.seed(SCHEMA_TYPE.AGENTS, { name: 'Secret agent', role: TRIAGER, ownerId: OWNER, projectIds: [oid()], deletedStatusKey: 0 });
        const res = await call(ORG_ROUTE, OUTSIDER);
        expect(rolesOf(res.body.data)).toEqual([]);
        expect(JSON.stringify(res.body)).not.toContain('Secret');
    });

    it('reads the playbook team field when there is one, else the department', () => {
        const { all } = require('../Modules/Agents/rolePlaybooks');
        expect(all().every((role) => (role.team || role.department))).toBe(true);
    });

    it('answers off while the flag is off', async () => {
        seedProject('Launch');
        process.env.DISPATCHER = 'off';
        const res = await call(ORG_ROUTE);
        expect(res.body.data).toEqual({ on: false, blueprints: [] });
    });
});

describe('company view: flow board', () => {
    it('counts what waits, what is queued, held and stuck per role, and the tasks needing routing', async () => {
        const project = seedProject('Launch');
        const queued = seedTask(project, { TaskName: 'Queued' });
        const claimed = seedTask(project, { TaskName: 'Claimed' });
        const approving = seedTask(project, { TaskName: 'Approving' });
        const old = seedTask(project, { TaskName: 'Old', updatedAt: new Date(Date.now() - 4 * DAY_MS) });
        const fresh = seedTask(project, { TaskName: 'Fresh', updatedAt: new Date(Date.now() - 2 * DAY_MS) });
        const suggested = seedTask(project, { TaskName: 'Suggested' });
        const unrouted = seedTask(project, { TaskName: 'Unrouted' });
        seedQueue(project, queued, TRIAGER);
        seedQueue(project, claimed, TRIAGER, { claim: { by: 'conn', userId: MEMBER, until: new Date(Date.now() + 60000) } });
        seedQueue(project, approving, TRIAGER, { proposalId: oid() });
        seedQueue(project, old, TRIAGER);
        seedQueue(project, fresh, REVIEWER);
        seedDecision(project, suggested);
        seedDecision(project, unrouted, { state: 'needs_routing', role: null, source: null });

        const { body } = await call(FLOW_ROUTE);
        const triager = laneOf(body.data, TRIAGER);
        expect(triager).toMatchObject({ waiting: { count: 1 }, queued: { count: 2 }, held: { count: 2 }, stuck: { count: 1 } });
        expect(triager.held.items.map((entry) => [entry.taskName, entry.why]).sort()).toEqual([['Approving', 'approval'], ['Claimed', 'claimed']]);
        expect(triager.stuck.items[0]).toMatchObject({ taskName: 'Old', stuck: true, project: 'Launch' });
        expect(laneOf(body.data, REVIEWER)).toMatchObject({ waiting: { count: 0 }, queued: { count: 1 }, stuck: { count: 0 } });
        expect(body.data.unrouted).toMatchObject({ count: 1, items: [expect.objectContaining({ taskName: 'Unrouted' })] });
        expect(body.data.stuckDays).toBe(3);
    });

    it('skips finished tasks, a role switched off in the project, and a row that left the queue', async () => {
        const project = seedProject('Launch', [OWNER, MEMBER], { roles: [TRIAGER] });
        const done = seedTask(project, { statusType: 'close' });
        const left = seedTask(project);
        const other = seedTask(project);
        seedQueue(project, done, TRIAGER);
        seedQueue(project, left, TRIAGER, { leftQueue: 'finished' });
        seedQueue(project, other, REVIEWER);
        seedDecision(project, other, { role: REVIEWER });
        const { body } = await call(FLOW_ROUTE);
        expect(body.data.roles.map((lane) => lane.key)).toEqual([TRIAGER]);
        expect(body.data.roles[0]).toMatchObject({ waiting: { count: 0 }, queued: { count: 0 }, held: { count: 0 }, stuck: { count: 0 } });
    });

    it('shows only the projects the person may open', async () => {
        const secret = seedProject('Secret', [OWNER]);
        const shared = seedProject('Shared', [OWNER, OUTSIDER]);
        seedQueue(secret, seedTask(secret, { TaskName: 'Hidden' }), TRIAGER);
        seedQueue(shared, seedTask(shared, { TaskName: 'Visible' }), TRIAGER);
        const { body } = await call(FLOW_ROUTE, OUTSIDER);
        expect(laneOf(body.data, TRIAGER).queued).toMatchObject({ count: 1, items: [expect.objectContaining({ taskName: 'Visible' })] });
        expect(JSON.stringify(body)).not.toContain('Hidden');
    });

    it('caps the tasks it lists and answers off while the flag is off', async () => {
        const project = seedProject('Launch');
        for (let i = 0; i < 8; i += 1) seedQueue(project, seedTask(project, { TaskName: `T${i}` }), TRIAGER);
        const { body } = await call(FLOW_ROUTE);
        expect(laneOf(body.data, TRIAGER).queued.count).toBe(8);
        expect(laneOf(body.data, TRIAGER).queued.items).toHaveLength(5);
        process.env.DISPATCHER = 'off';
        expect((await call(FLOW_ROUTE)).body.data).toMatchObject({ on: false, roles: [] });
    });
});

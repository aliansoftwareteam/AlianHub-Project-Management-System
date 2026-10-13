const fakeMongo = require('./fixtures/fakeMongo');

const mockDb = fakeMongo.create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Automations/engine/tools', () => ({ oid: (id) => (/^[0-9a-fA-F]{24}$/.test(String(id)) ? String(id) : null) }));
jest.mock('../Modules/Agents/actions', () => {
    const real = jest.requireActual('../Modules/Agents/actions');
    class RefusedError extends Error {
        constructor(message) { super(message); this.name = 'RefusedError'; this.status = 403; }
    }
    return {
        RefusedError,
        SCOPE: real.SCOPE,
        rating: real.rating,
        unrated: real.unrated,
        authorizeRead: jest.fn(async () => true),
        perform: jest.fn(async () => ({ auditId: 'audit-1', result: { ok: 1 } })),
        refusal: jest.fn(async (companyId, actor, { reason }) => new RefusedError(reason)),
    };
});
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { taskListRules } = require('./fixtures/taskListRules');
const tools = require('../Modules/Mcp/tools');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000003';
const READER = '6f0000000000000000000004';
const NO_LIST = '6f0000000000000000000005';
const P_COMPANY = '6f0000000000000000000a01';
const P_OWN = '6f0000000000000000000a02';
const PL_NO_LIST = '6f0000000000000000000a03';
const EVERYONE = [OWNER, MEMBER, READER, NO_LIST];

let fx;

const ctx = (uid) => ({
    companyId: C,
    userId: uid,
    actor: { kind: 'agent', userId: uid },
    ip: '1.1.1.1',
    projectIds: [],
    token: { _id: 'tok', userId: uid, scopes: [], active: true },
    canWrite: true,
});
const call = (uid, name, args = {}) => tools.call(ctx(uid), name, args);
const keys = (out) => out.tasks.map((task) => task.key).sort();
const briefs = async (uid) => {
    const found = [];
    for (const task of fx) {
        const brief = await call(uid, 'task.get', { taskId: String(task._id) });
        if (!brief.error) found.push(task.TaskKey);
    }
    return found.sort();
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; });
    jest.clearAllMocks();
    myCache.flushAll();
    delete process.env.MCP_TOOLS_V2;

    [[OWNER, 1], [MEMBER, 3], [READER, 4], [NO_LIST, 5]].forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    taskListRules({ 3: true, 4: false }).forEach((rule) => mockDb.seed(SCHEMA_TYPE.RULES, rule));
    taskListRules({ 4: true, 5: false }, { projectId: P_OWN }).forEach((rule) => mockDb.seed(SCHEMA_TYPE.PROJECT_RULES, rule));
    const project = (_id, ProjectName, extra = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, {
        _id, ProjectName, ProjectCode: ProjectName.toUpperCase(), isPrivateSpace: false, AssigneeUserId: [], taskStatusData: [], deletedStatusKey: 0, isGlobalPermission: true, ...extra,
    });
    project(P_COMPANY, 'Company');
    project(P_OWN, 'Own', { isGlobalPermission: false });
    project(PL_NO_LIST, 'Personal', { isPrivateSpace: true, isPersonal: true, personalOwner: NO_LIST, AssigneeUserId: [NO_LIST] });
    const task = (TaskKey, ProjectID, AssigneeUserId) => mockDb.seed(SCHEMA_TYPE.TASKS, {
        TaskKey, TaskName: `Task ${TaskKey}`, CompanyId: C, ProjectID, AssigneeUserId, statusType: 'open', deletedStatusKey: 0,
    });
    fx = [task('COMPANY-1', P_COMPANY, EVERYONE), task('OWN-1', P_OWN, EVERYONE), task('PERSONAL-1', PL_NO_LIST, [NO_LIST])];
});

describe.each([
    ['a role the project leaves unset', MEMBER, ['COMPANY-1']],
    ['a read-only role', READER, ['COMPANY-1', 'OWN-1']],
    ['a role the company leaves unset', NO_LIST, ['OWN-1', 'PERSONAL-1']],
    ['an owner', OWNER, ['COMPANY-1', 'OWN-1']],
])('what %s reads over MCP', (who, uid, expected) => {
    it('tasks.search keeps to the projects whose task list the role holds', async () => {
        expect(keys(await call(uid, 'tasks.search', {}))).toEqual(expected);
    });

    it('tasks.next keeps to the same projects', async () => {
        expect(keys(await call(uid, 'tasks.next', {}))).toEqual(expected);
    });

    it('task.get answers for the same tasks', async () => {
        expect(await briefs(uid)).toEqual(expected);
    });

    it('a named project narrows the search and never widens it', async () => {
        expect(keys(await call(uid, 'tasks.search', { projectId: P_OWN }))).toEqual(expected.filter((key) => key === 'OWN-1'));
    });
});

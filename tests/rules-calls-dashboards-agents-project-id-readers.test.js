/* Task 040 phase 2: the readers of projectId on project rules, call notes, dashboards, agent runs and
   agent proposals match both stored forms, so rows keep being found while a migration moves them from
   text to ObjectId. Each filter is matched the way MongoDB matches it, where an ObjectId never equals its hex. */
const { matchesLikeMongo, filterOf, bson, oid } = require('./fixtures/storedForms');
const verified = require('./fixtures/verifiedRequest');

const mockCrud = jest.fn();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: jest.fn(), set: jest.fn(), del: jest.fn(), getTtl: jest.fn() } }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/settings/securityPermissions/controller', () => ({ fetchRules: jest.fn(async () => []) }));
jest.mock('../Modules/AICore/persistence', () => ({ storeFor: () => ({ search: async () => [] }) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(), visibleProjects: jest.fn() }));
jest.mock('../Modules/Sprints/helpers/sprintVisibility', () => ({ hiddenSprintFilter: jest.fn(async () => ({})), hiddenSprintIds: jest.fn(async () => []) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const scope = require('../Modules/Agents/scope');
const projectRules = require('../Modules/projectRules/controller');
const permissionGuard = require('../Config/permissionGuard');
const { clausesFor } = require('../Modules/Knowledge/visibleSet');
const dashboard = require('../Modules/UserDashboard/controller');
const runs = require('../Modules/Agents/runs');
const proposals = require('../Modules/Agents/proposals');
const memory = require('../Modules/Agents/memory');
const shipping = require('../Modules/Agents/shipping');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const PROJECT = '6f0000000000000000000b01';
const OTHER_PROJECT = '6f0000000000000000000b02';
const BOTH = ['ObjectId form', 'text form'];

const threeRows = (extra) => [
    { _id: 'row-text', name: 'text form', projectId: PROJECT, ...extra },
    { _id: 'row-oid', name: 'ObjectId form', projectId: oid(PROJECT), ...extra },
    { _id: 'row-other', name: 'other project', projectId: oid(OTHER_PROJECT), ...extra },
];

const ROWS = {
    [SCHEMA_TYPE.PROJECT_RULES]: threeRows({ key: 'task_create', roles: [{ key: 3, permission: true }] }),
    [SCHEMA_TYPE.CALLS]: threeRows({ participants: [ME], deletedStatusKey: 0 }),
    [SCHEMA_TYPE.USERDASHBOARD]: threeRows({ visibility: 'project', ownerId: 'someone else', isDeleted: false }),
    [SCHEMA_TYPE.AGENT_RUNS]: threeRows({ agentId: 'a1', status: 'running', taskId: 't1', episode: { skill: 'qa' } }),
    [SCHEMA_TYPE.AGENT_PROPOSALS]: threeRows({ agentId: 'a1', status: 'pending', taskId: 't1', gate: 'deploy', changes: [] }),
};

const found = (type, filter) => (ROWS[type] || []).filter(matchesLikeMongo(filter));
const namesOf = (rows) => rows.map((row) => row.name).sort();
const namesProjectId = (filter) => JSON.stringify(bson(filter)).includes('projectId');

/* Only the reads that pick rows by project: a lookup by _id elsewhere in a handler is not the question. */
const projectReads = (type) => mockCrud.mock.calls
    .filter(([, q]) => q.type === type)
    .map(([, { data }, method]) => filterOf(method, data))
    .filter(namesProjectId)
    .map((filter) => namesOf(found(type, filter)));

const expectEveryReadFindsBoth = (type) => {
    const reads = projectReads(type);
    expect(reads.length).toBeGreaterThan(0);
    reads.forEach((names) => expect(names).toEqual(BOTH));
};

beforeEach(() => {
    jest.clearAllMocks();
    scope.visibleProjectIds.mockResolvedValue([PROJECT]);
    mockCrud.mockImplementation(async (companyId, { type, data }, method) => {
        if (type === SCHEMA_TYPE.COMPANY_USERS) return method === 'findOne' ? { userId: ME, roleType: 3 } : [{ userId: ME, roleType: 3 }];
        if (type === SCHEMA_TYPE.PROJECTS) {
            const project = { _id: oid(PROJECT), ProjectName: 'Parity', isGlobalPermission: false };
            return method === 'findOne' ? project : [project];
        }
        if (ROWS[type]) {
            if (method === 'aggregate') return [];
            const rows = found(type, filterOf(method, data));
            if (method === 'findOne' || method === 'findOneAndUpdate') return rows[0] || null;
            if (method === 'deleteMany') return { deletedCount: rows.length };
            return rows;
        }
        return method === 'findOne' ? null : [];
    });
});

const call = async (handler, { body = {}, params = {}, query = {} } = {}) => {
    const r = { code: 200, body: null, headers: {} };
    r.status = (code) => { r.code = code; return r; };
    r.json = (answer) => { r.body = answer; return r; };
    r.send = r.json;
    r.set = (h) => { Object.assign(r.headers, h); return r; };
    await handler(verified({ headers: { companyid: C }, body, params, query, uid: ME }), r);
    return r;
};

describe('project rules are found by either form of their project id', () => {
    test('the project rules route (projectRules getProjectRules)', async () => {
        const r = await call(projectRules.getProjectRules, { params: { pid: PROJECT } });
        expect(namesOf(r.body)).toEqual(BOTH);
        expectEveryReadFindsBoth(SCHEMA_TYPE.PROJECT_RULES);
    });

    test('deleting a project\'s rules (projectRules deleteProjectRules)', async () => {
        await call(projectRules.deleteProjectRules, { params: { pid: PROJECT } });
        expectEveryReadFindsBoth(SCHEMA_TYPE.PROJECT_RULES);
    });

    const RULE_ID_OF = { 'text form': '6f00000000000000000000a1', 'ObjectId form': '6f00000000000000000000a2' };
    test.each(Object.entries(RULE_ID_OF))('editing the rule stored in %s (projectRules updateProjectRules)', async (name, id) => {
        const stored = ROWS[SCHEMA_TYPE.PROJECT_RULES];
        ROWS[SCHEMA_TYPE.PROJECT_RULES] = stored.map((row) => ({ ...row, _id: RULE_ID_OF[row.name] || row._id }));
        try {
            const r = await call(projectRules.updateProjectRules, { body: { id, key: '$set', projectId: PROJECT, updateObject: { roles: [] } } });
            expect(r.code).toBe(200);
            expect(r.body.name).toBe(name);
        } finally {
            ROWS[SCHEMA_TYPE.PROJECT_RULES] = stored;
        }
    });

    test('the permission evaluator reads a project\'s own rules stored in either form (permissionGuard evaluatePermission)', async () => {
        const stored = ROWS[SCHEMA_TYPE.PROJECT_RULES];
        ROWS[SCHEMA_TYPE.PROJECT_RULES] = [
            { _id: 'parent', name: 'Task', key: 'task', isParent: true, roles: [], projectId: oid(PROJECT) },
            { _id: 'child', name: 'Create', key: 'task_create', isParent: false, parentId: 'parent', roles: [{ key: 3, permission: true }], projectId: PROJECT },
        ];
        try {
            expect(await permissionGuard.evaluatePermission(C, ME, 'task.task_create', { projectId: PROJECT })).toBe(true);
        } finally {
            ROWS[SCHEMA_TYPE.PROJECT_RULES] = stored;
        }
    });
});

describe('call notes are found by either form of their project id', () => {
    const set = (extra) => ({ companyId: C, caller: { userId: ME }, projectIds: [PROJECT], hiddenSprintIds: [], fileProjectIds: [], ...extra });

    test.each([
        ['a search scoped to one project', set({ projectId: PROJECT })],
        ['a project-bound search', set({ projectBound: true, reachesProjectless: true })],
    ])('the transcript row clause for %s (Knowledge visibleSet clausesFor)', (_, visible) => {
        expect(namesOf(found(SCHEMA_TYPE.CALLS, clausesFor(visible).transcript))).toEqual(BOTH);
    });
});

describe('project dashboards are found by either form of their project id', () => {
    test('the dashboard hub list (UserDashboard listDashboards)', async () => {
        const r = await call(dashboard.listDashboards);
        expect(r.body.data.map((d) => d._id).sort()).toEqual(['row-oid', 'row-text']);
        expectEveryReadFindsBoth(SCHEMA_TYPE.USERDASHBOARD);
    });
});

describe('agent runs are found by either form of their project id', () => {
    test.each([
        ['a project filter (runs.list)', () => runs.list(C, { projectId: PROJECT })],
        ['the caller\'s visible projects (runs.list)', () => runs.list(C, { projectIds: [PROJECT] })],
        ['the live summary (runs.summary)', () => runs.summary(C, { projectId: PROJECT, projectIds: [PROJECT] })],
        ['the counts by status, an aggregate that does not convert (runs.countsByStatus)', () => runs.countsByStatus(C, { projectId: PROJECT, projectIds: [PROJECT] })],
        ['the project memory episodes (memory.listProject)', () => memory.listProject({ companyId: C, projectId: PROJECT })],
    ])('%s', async (_, run) => {
        await run();
        expectEveryReadFindsBoth(SCHEMA_TYPE.AGENT_RUNS);
    });
});

describe('agent proposals are found by either form of their project id', () => {
    test.each([
        ['the AI inbox (proposals.list)', () => proposals.list(C, { projectIds: [PROJECT] })],
        ['the release candidate for a member (shipping.releaseCandidate)', () => shipping.releaseCandidate(C, ME)],
    ])('%s', async (_, run) => {
        await run();
        expectEveryReadFindsBoth(SCHEMA_TYPE.AGENT_PROPOSALS);
    });
});

const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/settings/securityPermissions/controller', () => ({
    fetchRules: jest.fn(async () => [{ key: 'private_projects', roles: [{ key: 0, permission: 1 }, { key: 3, permission: 1 }] }]),
}));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: () => false }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 0), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Knowledge/flag', () => ({ enabledFor: jest.fn(async () => false) }));
jest.mock('../event/socketEventEmitter', () => ({}));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { runNarrowed } = require('../Config/tokenNarrowing');
const { gather } = require('../Modules/AI/ask');

const C = '6f0000000000000000000c01';
const SHARED = '6f0000000000000000000a01';
const CLOSED = '6f0000000000000000000a02';
const GUEST = '6f0000000000000000000011';
const OWNER = '6f0000000000000000000012';
const PRIYA = '6f0000000000000000000013';
const NOW = new Date('2026-09-28T10:00:00Z');
const days = (n) => new Date(NOW.getTime() + n * 86400000);

const filtered = (out) => out.sources.filter((s) => s.matchedBy === 'filter').map((s) => s.title).sort();

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: GUEST, roleType: 0, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: PRIYA, roleType: 3, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: PRIYA, Employee_Name: 'Priya Shah', Employee_FName: 'Priya', Employee_LName: 'Shah' });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: GUEST, Employee_Name: 'Gita Guest', Employee_FName: 'Gita', Employee_LName: 'Guest' });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: SHARED, ProjectName: 'Client Portal', ProjectCode: 'CP', isPrivateSpace: true, AssigneeUserId: [GUEST], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: CLOSED, ProjectName: 'Internal Finance', ProjectCode: 'FIN', isPrivateSpace: true, AssigneeUserId: [OWNER, PRIYA], deletedStatusKey: 0 });
    const task = (ProjectID, TaskName, AssigneeUserId) => mockDb.seed(SCHEMA_TYPE.TASKS, {
        TaskName, TaskKey: `${TaskName.slice(0, 3).toUpperCase()}-1`, ProjectID, AssigneeUserId, deletedStatusKey: 0, statusType: 'default_active', DueDate: days(-2),
    });
    task(SHARED, 'Portal login copy', [GUEST]);
    task(CLOSED, 'Finance payroll run', [PRIYA]);
});

describe('a guest asks a structured question', () => {
    it('gets only the tasks in the projects shared with them', async () => {
        expect(filtered(await gather(C, GUEST, { question: 'What is overdue?', now: NOW }))).toEqual(['Portal login copy']);
    });

    it('gets nothing, and learns nothing, by naming a project not shared with them', async () => {
        const named = await gather(C, GUEST, { question: 'Which tasks in Internal Finance are overdue?', now: NOW });
        expect(named.sources.map((s) => s.title)).not.toContain('Finance payroll run');
        expect(named.intent.projects).toBeUndefined();
    });

    it('resolves only people on the projects shared with them', async () => {
        const out = await gather(C, GUEST, { question: 'What is overdue for Priya Shah?', now: NOW });
        expect(out.intent.assignee).toBeUndefined();
        const self = await gather(C, GUEST, { question: 'What is overdue for Gita Guest?', now: NOW });
        expect(self.intent.assignee).toEqual({ id: GUEST, name: 'Gita Guest' });
    });

    it('stays inside a narrowed token when the request runs under it', async () => {
        const out = await runNarrowed({ userId: GUEST, projectIds: [CLOSED] }, () => gather(C, GUEST, { question: 'What is overdue?', now: NOW }));
        expect(out.sources).toEqual([]);
    });
});

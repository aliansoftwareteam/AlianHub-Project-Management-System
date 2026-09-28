const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjects: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: () => false }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 3), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Knowledge/flag', () => ({ enabledFor: jest.fn(async () => false) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibleProjects } = require('../Modules/Agents/scope');
const { gather } = require('../Modules/AI/ask');
const SET = require('./fixtures/askIntent.cases.json');

const C = '6f0000000000000000000c01';
const NOW = new Date(SET.now);
const DAY = 86400000;
const at = (days) => (days === null || days === undefined ? null : new Date(NOW.getTime() + days * DAY));

const projectByCode = Object.fromEntries(SET.projects.map((p) => [p.code, p]));
const memberByFirst = Object.fromEntries(SET.members.map((m) => [m.first, m]));
const sprintByName = Object.fromEntries(SET.sprints.map((s) => [s.name, s]));
const statusByKey = Object.fromEntries(SET.statuses.map((s) => [s.key, s]));

beforeAll(() => {
    SET.projects.forEach((p) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: p.id, ProjectName: p.name, ProjectCode: p.code, taskStatusData: SET.statuses, deletedStatusKey: 0 }));
    SET.members.forEach((m) => {
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: m.id, roleType: 3, status: 2, isDelete: false });
        mockDb.seed(SCHEMA_TYPE.USERS, { _id: m.id, Employee_Name: `${m.first} ${m.last}`, Employee_FName: m.first, Employee_LName: m.last });
    });
    SET.sprints.forEach((s) => mockDb.seed(SCHEMA_TYPE.SPRINTS, {
        _id: s.id, name: s.name, projectId: projectByCode[s.project].id, isScrum: s.isScrum, state: s.state, endDate: at(s.endInDays), private: false, deletedStatusKey: 0,
    }));
    SET.tasks.forEach((t) => {
        const status = statusByKey[t.status];
        mockDb.seed(SCHEMA_TYPE.TASKS, {
            TaskKey: t.key, TaskName: `Task ${t.key}`, ProjectID: projectByCode[t.project].id, deletedStatusKey: 0,
            statusKey: status.key, statusType: status.type, status: { text: status.name, key: status.key, type: status.type },
            AssigneeUserId: t.assignee ? [memberByFirst[t.assignee].id] : [], DueDate: at(t.dueInDays),
            ...(t.sprint ? { sprintId: sprintByName[t.sprint].id } : {}), updatedAt: at(-20),
        });
    });
    visibleProjects.mockResolvedValue(SET.projects.filter((p) => p.visible).map((p) => ({ _id: p.id, ProjectName: p.name })));
});

describe('the held-out structured question set', () => {
    it.each(SET.cases.map((c) => [c.question, c.expect]))('%s', async (question, expected) => {
        const out = await gather(C, SET.asker, { question, now: NOW });
        expect(out.sources.filter((s) => s.matchedBy === 'filter').map((s) => s.ref).sort()).toEqual([...expected].sort());
        if (expected.length) expect(out.intent.total).toBe(expected.length);
    });
});

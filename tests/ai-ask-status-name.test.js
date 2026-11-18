const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjects: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: () => false }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 3), isPrivileged: () => false }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibleProjects } = require('../Modules/Agents/scope');
const { gather } = require('../Modules/AI/ask');

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const ME = '6f0000000000000000000001';

const task = (over) => mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Release checklist', ProjectID: PROJECT, deletedStatusKey: 0, Task_Priority: 'HIGH', updatedAt: new Date(), ...over });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    visibleProjects.mockResolvedValue([{ _id: PROJECT, ProjectName: 'Ops' }]);
});

describe('AUT-10 Ask describes a task by its status name', () => {
    it('uses the stored status text, never [object Object]', async () => {
        task({ status: { text: 'To Do', key: 1, type: 'default_active' } });
        const { sources } = await gather(C, ME, { question: 'release' });
        expect(sources[0].detail).toBe('To Do · HIGH');
    });

    it('falls back to the status type when the status has no text', async () => {
        task({ status: { key: 1 }, statusType: 'active' });
        const { sources } = await gather(C, ME, { question: 'release' });
        expect(sources[0].detail).toBe('active · HIGH');
    });
});

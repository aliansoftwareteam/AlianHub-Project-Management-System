jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { gatherStandupContext } = require('../Modules/Pages/helpers/runWorkspaceAsk');

const PROJ = '64b7f0c2a1b2c3d4e5f60711';
const OTHER = '64b7f0c2a1b2c3d4e5f60722';
const NOW = new Date('2026-08-27T12:00:00.000Z');

describe('PAGES - standup gather (permission pack)', () => {

    beforeEach(() => {
        MongoDbCrudOpration.mockReset();
    });

    test('missing projectId does not query tasks', async () => {
        const result = await gatherStandupContext({
            companyId: 'co1',
            uid: 'u1',
            projectId: '',
            window: '24h',
            now: NOW,
        });
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/project/i);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
        expect(result.tasks).toEqual([]);
    });

    test('restricted callers cannot pack a project they cannot see', async () => {
        MongoDbCrudOpration.mockImplementation(async (_companyId, mongoObj) => {
            if (mongoObj.type === SCHEMA_TYPE.COMPANY_USERS) return { roleType: 3 };
            if (mongoObj.type === SCHEMA_TYPE.PROJECTS) return [{ _id: OTHER }];
            return [];
        });

        const result = await gatherStandupContext({
            companyId: 'co1',
            uid: 'u1',
            projectId: PROJ,
            window: '24h',
            now: NOW,
        });
        expect(result.allowed).toBe(false);
        expect(result.tasks).toEqual([]);
        expect(MongoDbCrudOpration.mock.calls.some((call) => call[1].type === SCHEMA_TYPE.TASKS)).toBe(false);
    });

    test('visible project returns that project\'s tasks and comments', async () => {
        MongoDbCrudOpration.mockImplementation(async (_companyId, mongoObj) => {
            if (mongoObj.type === SCHEMA_TYPE.COMPANY_USERS) return { roleType: 3 };
            if (mongoObj.type === SCHEMA_TYPE.PROJECTS) return [{ _id: PROJ }];
            if (mongoObj.type === SCHEMA_TYPE.TASKS) {
                return [{ _id: 't1', TaskKey: 'SMOKE-1', TaskName: 'Ship the invite', ProjectID: PROJ, deletedStatusKey: 0 }];
            }
            if (mongoObj.type === SCHEMA_TYPE.COMMENTS) {
                return [{ taskId: 't1', message: 'Shipped to staging.', createdAt: NOW }];
            }
            return [];
        });

        const result = await gatherStandupContext({
            companyId: 'co1',
            uid: 'u1',
            projectId: PROJ,
            window: '24h',
            now: NOW,
        });
        expect(result.allowed).toBe(true);
        expect(result.tasks).toHaveLength(1);
        expect(result.tasks[0].TaskKey).toBe('SMOKE-1');
        expect(result.comments).toHaveLength(1);
        expect(result.window.key).toBe('24h');
    });
});

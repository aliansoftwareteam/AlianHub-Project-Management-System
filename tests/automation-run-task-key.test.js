jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const runner = require('../Modules/Automations/engine/runner');

const TASK_ID = '507f1f77bcf86cd799439011';
const envelope = (key) => ({ id: 'evt_1', type: 'task.created', depth: 0, entity: { kind: 'task', id: TASK_ID, key }, data: { _id: TASK_ID, TaskKey: key } });

beforeEach(() => MongoDbCrudOpration.mockReset());

describe('AUT-11 a run records the task key, not the create placeholder', () => {
    it.each(['--', '-', null])('resolves the placeholder %p from the stored task', async (placeholder) => {
        MongoDbCrudOpration.mockImplementation(async (companyId, { type, data }, method) => {
            if (method === 'findOne' && type === SCHEMA_TYPE.TASKS) return { _id: TASK_ID, TaskKey: 'QAS-13' };
            if (method === 'save') return data;
            return null;
        });
        const run = await runner.createRun('c1', { _id: 'r1', name: 'On create' }, envelope(placeholder));
        expect(run.entity).toEqual({ kind: 'task', id: TASK_ID, key: 'QAS-13' });
        expect(run.envelope.entity.key).toBe('QAS-13');
    });

    it('keeps a real key without reading the task', async () => {
        MongoDbCrudOpration.mockImplementation(async (companyId, { data }, method) => (method === 'save' ? data : null));
        const run = await runner.createRun('c1', { _id: 'r1', name: 'On create' }, envelope('QAS-12'));
        expect(run.entity.key).toBe('QAS-12');
        expect(MongoDbCrudOpration).toHaveBeenCalledTimes(1);
    });

    it('keeps the placeholder when the task still has none', async () => {
        MongoDbCrudOpration.mockImplementation(async (companyId, { type, data }, method) => {
            if (method === 'findOne' && type === SCHEMA_TYPE.TASKS) return { _id: TASK_ID, TaskKey: '--' };
            return method === 'save' ? data : null;
        });
        const run = await runner.createRun('c1', { _id: 'r1', name: 'On create' }, envelope('--'));
        expect(run.entity.key).toBe('--');
    });
});

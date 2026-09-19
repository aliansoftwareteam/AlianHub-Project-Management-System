jest.mock('../middlewares/mongoConnector/mongoConnection', () => ({
    handleConnection: jest.fn(async () => ({ status: true, database: { model: () => { throw new Error('the database was reached'); } } })),
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { handleConnection } = require('../middlewares/mongoConnector/mongoConnection');
const { SCHEMA_TYPE } = require('../Config/schemaType');

const COMPANY = '6f00000000000000000000c1';
const WRITES = ['findOneAndUpdate', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'findOneAndDelete'];

beforeEach(() => handleConnection.mockClear());

describe('a task write names its task before it reaches the database', () => {
    test.each(WRITES.flatMap((method) => [[method, 'undefined', undefined], [method, 'null', null], [method, 'an empty string', '']]))('%s with an _id of %s is refused without a connection', async (method, _, id) => {
        await expect(MongoDbCrudOpration(COMPANY, { type: SCHEMA_TYPE.TASKS, data: [{ _id: id }, { $set: { Task_Priority: 'HIGH' } }] }, method)).rejects.toThrow('must name the task');
        expect(handleConnection).not.toHaveBeenCalled();
    });

    test('a filter that names a task reaches the database', async () => {
        await expect(MongoDbCrudOpration(COMPANY, { type: SCHEMA_TYPE.TASKS, data: [{ _id: '6f0000000000000000000b01' }, { $set: { Task_Priority: 'HIGH' } }] }, 'findOneAndUpdate')).rejects.toThrow('the database was reached');
        expect(handleConnection).toHaveBeenCalledTimes(1);
    });

    test('a filter without an _id, such as a parent lookup, reaches the database', async () => {
        await expect(MongoDbCrudOpration(COMPANY, { type: SCHEMA_TYPE.TASKS, data: [{ ParentTaskId: '6f0000000000000000000b01' }, { $set: { deletedStatusKey: 3 } }] }, 'updateMany')).rejects.toThrow('the database was reached');
        expect(handleConnection).toHaveBeenCalledTimes(1);
    });
});

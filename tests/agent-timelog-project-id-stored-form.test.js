/* Task 040 phase 2: time an agent logs or starts (Agents/actions.js timelog.create and timelog.start)
   is stored with its project id as an ObjectId. The actions run against fakeMongo, and each save
   they make is replayed through the real timesheet schema. */
process.env.MCP_TOOLS_DATA = 'on';
const mongoose = require('mongoose');
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ publishCommentChanged: jest.fn(), publish: jest.fn() }));
jest.mock('../Modules/Agents/permissions', () => ({ holderMay: jest.fn(async () => ({ allowed: true, reason: '' })) }));
jest.mock('../Modules/Tasks/helpers/completionStore', () => ({ recordWork: jest.fn(async () => null), forStatusChange: jest.fn(async () => null) }));
jest.mock('../Modules/Agents/agentAudit', () => ({
    openAction: jest.fn(async () => 'audit-1'),
    applyAction: jest.fn(async () => null),
    failAction: jest.fn(async () => null),
    recordRefusal: jest.fn(async () => 'ref-1'),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const actions = require('../Modules/Agents/actions');
const { timeSheetSchema } = require('../utils/mongo-handler/createSchema');
const { realModelStore, isObjectId } = require('./fixtures/realModelStore');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const PROJECT = '6f0000000000000000000a01';
const actor = { kind: 'agent', userId: ME, agentId: null, viaAccount: 'personal', personName: 'Mia' };
const { driverWrites } = realModelStore(SCHEMA_TYPE.TIMESHEET, timeSheetSchema);

const perform = (action, params) => actions.perform({ companyId: C, actor, action, params, reason: `${action} via MCP` });
const savedProjectIds = async () => {
    const saves = mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.TIMESHEET && c.method === 'save');
    expect(saves).toHaveLength(1);
    const { writes, error } = await driverWrites('save', saves[0].data);
    expect(error).toBeNull();
    return writes.map(({ args }) => args[0].ProjectId);
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
});

describe.each([
    ['an ObjectId', () => new mongoose.Types.ObjectId(PROJECT)],
    ['text', () => PROJECT],
])('a task whose project id is %s', (_, projectOf) => {
    let task;
    beforeEach(() => {
        task = mockDb.seed(SCHEMA_TYPE.TASKS, { TaskKey: 'A-1', TaskName: 'Ship it', CompanyId: C, ProjectID: projectOf(), sprintId: '6f00000000000000000000b1', deletedStatusKey: 0 });
    });

    test.each([
        ['timelog.create', { minutes: 30, date: '2026-09-01', startTime: '10:00' }],
        ['timelog.start', {}],
    ])('%s stores the time with its project id as an ObjectId', async (action, params) => {
        await perform(action, { taskId: task._id, ...params });
        const [stored] = await savedProjectIds();
        expect(isObjectId(stored)).toBe(true);
        expect(String(stored)).toBe(PROJECT);
    });
});

/* Task 040 phase 2: history.ProjectId, and projectId, sprintId and folderId on notifications and mentions,
   are stored as ObjectIds, whichever form the writer passed. Every stored form is read from what Mongoose
   hands the driver under the real schema; the writers' own database calls are only recorded and replayed. */
const mongoose = require('mongoose');

process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const mockCrud = jest.fn();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: jest.fn(), set: jest.fn(), del: jest.fn(), getTtl: jest.fn() } }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/CustomField/controller', () => ({ insertCustomFieldPromise: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: jest.fn(async () => ({})), updateSprintCount: jest.fn() }));
jest.mock('../Modules/Inbox/helpers/inboxState', () => ({ wakeOnActivity: jest.fn(async () => {}) }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: jest.fn(async () => {}) }));
jest.mock('../Modules/Project/helpers/projectHistory', () => ({ projectActor: jest.fn(async () => ({ id: 'u' })) }));
jest.mock('../Modules/notification/activeMembers', () => ({ activeMemberIds: jest.fn(async (companyId, ids) => ids) }));

const { historySchema, notificationsSchema, mentionsSchema } = require('../utils/mongo-handler/createSchema');
const { realModelStore, isObjectId } = require('./fixtures/realModelStore');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const helper = require('../Modules/Tasks/helpers/helper');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const prepare = require('../Modules/notification/prepare-notification-data/controllerV2');
const { deliverMentions } = require('../Modules/Comments/helpers/commentNotifications');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const PROJECT = '6f0000000000000000000b01';
const SPRINT = '6f0000000000000000000a01';
const FOLDER = '6f0000000000000000000f01';
const TASK = '6f0000000000000000000d01';
const ROW = '6f0000000000000000000e01';
const oid = (id) => new mongoose.Types.ObjectId(id);
const ID_OF = { ProjectId: PROJECT, projectId: PROJECT, sprintId: SPRINT, folderId: FOLDER };

const COLLECTIONS = [
    { type: SCHEMA_TYPE.HISTORY, schema: historySchema, fields: ['ProjectId'], doc: { Key: 'Task_Status', Message: 'm', Type: 'task', UserId: ME, TaskId: TASK } },
    { type: SCHEMA_TYPE.NOTIFICATIONS, schema: notificationsSchema, fields: ['projectId', 'sprintId', 'folderId'], doc: { key: 'tasks', message: 'm', type: 'tasks', userId: ME, assigneeUsers: [], uniqueId: 'u', taskId: TASK } },
    { type: SCHEMA_TYPE.MENTIONS, schema: mentionsSchema, fields: ['projectId', 'sprintId', 'folderId'], doc: { comment_id: 'c', comment_type: 'text', mentionIds: [ME], userId: ME, type: 'task', taskId: TASK } },
];
const STORES = Object.fromEntries(COLLECTIONS.map(({ type, schema }) => [type, realModelStore(type, schema)]));
const fieldsOf = (type) => COLLECTIONS.find((c) => c.type === type).fields;

/* The written parts of a driver call only: a filter is sent as written and is checked on its own. */
const writtenParts = ({ op, args }) => {
    if (op === 'insertOne') return [args[0]];
    if (op === 'insertMany') return args[0];
    if (op === 'bulkWrite') return args[0].map((item) => (item.insertOne ? item.insertOne.document : (item.updateOne || item.updateMany).update));
    return [args[1]];
};
const valueOf = (part, field) => {
    if (part.$set && field in part.$set) return part.$set[field];
    if (part.$setOnInsert && field in part.$setOnInsert) return part.$setOnInsert[field];
    return part[field];
};
const storedIds = async (type, method, data) => {
    const { writes, error } = await STORES[type].driverWrites(method, data);
    expect(error).toBeNull();
    return writes.flatMap(writtenParts).flatMap((part) => fieldsOf(type).map((field) => [field, valueOf(part, field)])).filter(([, value]) => value !== undefined);
};
const expectObjectIds = (stored, fields) => {
    expect(stored.map(([field]) => field).sort()).toEqual(expect.arrayContaining([...fields].sort()));
    stored.forEach(([field, value]) => {
        expect(isObjectId(value)).toBe(true);
        expect(String(value)).toBe(ID_OF[field]);
    });
};

describe.each(COLLECTIONS)('the $type schema stores its ids as ObjectIds', ({ type, schema, fields, doc }) => {
    const withIds = (make) => ({ ...doc, ...Object.fromEntries(fields.map((field) => [field, make(ID_OF[field])])) });
    const asText = Object.fromEntries(fields.map((field) => [field, ID_OF[field]]));

    test.each([
        ['save', 'save', () => withIds(String)],
        ['insertMany', 'insertMany', () => [[withIds(String)]]],
        ['updateOne with $set', 'updateOne', () => [{ _id: ROW }, { $set: asText }]],
        ['updateMany without an operator', 'updateMany', () => [{ TaskId: TASK }, asText, { timestamps: false }]],
        ['findOneAndUpdate with an upsert', 'findOneAndUpdate', () => [{ _id: ROW }, { $set: asText }, { new: true, upsert: true }]],
        ['bulkWrite', 'bulkWrite', () => [[{ insertOne: { document: withIds(String) } }, { updateOne: { filter: { _id: ROW }, update: { $set: asText } } }]]],
    ])('%s converts a text id', async (_, method, data) => {
        expectObjectIds(await storedIds(type, method, data()), fields);
    });

    test('an id that is already an ObjectId is stored as it is', async () => {
        expectObjectIds(await storedIds(type, 'save', withIds(oid)), fields);
    });

    test('a value that is not an id is stored as sent', async () => {
        const sent = { ...withIds(String), [fields[0]]: 'ai-alerts', ...Object.fromEntries(fields.slice(1).map((field) => [field, ''])) };
        expect(await storedIds(type, 'save', sent)).toEqual([[fields[0], 'ai-alerts'], ...fields.slice(1).map((field) => [field, ''])]);
    });

    test(`an empty ${fields[0]} is still refused, as the text path refused it`, () => {
        const { Model } = STORES[type];
        const errorsOf = (sent) => (new Model(sent).validateSync() || { errors: {} }).errors;
        expect(errorsOf({ ...withIds(String), [fields[0]]: '' })).toHaveProperty(fields[0]);
        expect(errorsOf(withIds(String))).not.toHaveProperty(fields[0]);
        expect(errorsOf(withIds(oid))).not.toHaveProperty(fields[0]);
        expect(schema.path(fields[0]).isRequired).toBe(true);
    });

    test('a filter is sent as written, so a read still matches either form', async () => {
        const { writes, error } = await STORES[type].driverWrites('find', [{ [fields[0]]: { $in: [PROJECT, oid(PROJECT)] } }]);
        expect(error).toBeNull();
        const [text, id] = writes[0].args[0][fields[0]].$in;
        expect(text).toBe(PROJECT);
        expect(isObjectId(id)).toBe(true);
    });
});

describe('every writer of these ids stores ObjectIds through the schema', () => {
    const replayed = async (type, companyId = C) => {
        const writes = mockCrud.mock.calls
            .filter(([company, q, method]) => String(company) === companyId && q.type === type && ['save', 'insertMany', 'updateOne', 'updateMany', 'findOneAndUpdate', 'bulkWrite'].includes(method))
            .map(([, { data }, method]) => ({ method, data }));
        expect(writes.length).toBeGreaterThan(0);
        return (await Promise.all(writes.map(({ method, data }) => storedIds(type, method, data)))).flat();
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockCrud.mockImplementation(async (companyId, { type, data }, method) => {
            if (type === SCHEMA_TYPE.HISTORY && method === 'find') return [{ Type: 'task', Key: 'Task_Status', UserId: ME, ProjectId: PROJECT, TaskId: TASK, Message: 'm' }];
            if (type === SCHEMA_TYPE.PROJECTS && method === 'findOne') return { _id: oid(PROJECT) };
            if (method === 'save') return { id: ROW, _id: oid(ROW), ...data };
            if (method === 'insertMany') return data[0];
            return method === 'findOne' ? null : [];
        });
    });

    test.each([
        ['the task helper (Tasks/helpers/helper.js HandleHistory)', () => helper.HandleHistory('task', C, PROJECT, TASK, { key: 'Task_Status', message: 'm' }, { id: ME })],
        ['its copy (Tasks/helpers/mongo_helper.js HandleHistory)', () => mongoHelper.HandleHistory('task', C, oid(PROJECT), TASK, { key: 'Task_Status', message: 'm' }, { id: ME })],
        ['copying a task\'s history (mongo_helper addHistoryCollection)', () => mongoHelper.addHistoryCollection(C, { id: PROJECT }, { _id: oid(TASK) }, { id: TASK })],
        ['moving a task\'s history to another project (mongo_helper updateHistoryCollection)', () => mongoHelper.updateHistoryCollection(C, { _id: TASK }, { id: PROJECT }, TASK)],
    ])('%s', async (_, write) => {
        await write();
        await new Promise((resolve) => { setImmediate(resolve); });
        expectObjectIds(await replayed(SCHEMA_TYPE.HISTORY), ['ProjectId']);
    });

    test('a notification and its global delivery copy (prepare-notification-data createNotificationsBody)', async () => {
        await prepare.createNotificationsBody({ ...COLLECTIONS[1].doc, companyId: C, receiverID: ME, notificationType: 'push', projectId: PROJECT, sprintId: SPRINT, folderId: FOLDER });
        const fields = ['projectId', 'sprintId', 'folderId'];
        expectObjectIds(await replayed(SCHEMA_TYPE.NOTIFICATIONS), fields);
        expectObjectIds(await replayed(dbCollections.NOTIFICATIONS, dbCollections.GLOBAL), fields);
    });

    test('a mention (Comments commentNotifications deliverMentions)', async () => {
        const comment = { _id: oid(ROW), userId: ME, message: 'hi', type: 'text', projectId: oid(PROJECT), sprintId: oid(SPRINT), taskId: oid(TASK), folderId: FOLDER };
        expect(await deliverMentions(C, comment, ['6f0000000000000000000002'])).toEqual([]);
        expectObjectIds(await replayed(SCHEMA_TYPE.MENTIONS), ['projectId', 'sprintId', 'folderId']);
    });
});

/* Task 046 slice A1 follow-ups: a vote count that is exact when votes cross, link documents that go when their task
   goes, and a "has a value" question that reads only the projects the query keeps to. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const mongoose = require('mongoose');
const socketEmitter = require('../event/socketEventEmitter');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { schema } = require('../utils/mongo-handler/schema');
const { customFieldLinksSchema, taskSchema } = require('../utils/mongo-handler/createSchema');
const { realModelStore } = require('./fixtures/realModelStore');
const { castVote, withLinkConditions } = require('../Modules/CustomField/helpers/fieldLinks');
const { changeVote, storeTally, removeLinksOfTasks } = require('../Modules/CustomField/helpers/fieldLinkStore');
const { getTabSyncTasks } = require('../Modules/Tasks/controller/getTabSyncTasks');

mockDb.uniqueFromSchema(SCHEMA_TYPE.CUSTOM_FIELD_LINKS, customFieldLinksSchema);

const CID = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const OPEN_PROJECT = '6f0000000000000000000a01';
const OTHER_PROJECT = '6f0000000000000000000a02';
const SPRINT = '6f0000000000000000000d01';
const CLIENT = '6f0000000000000000000e31';
const VOTES = '6f0000000000000000000e32';
const task = (n) => `6f0000000000000000000b${String(n).padStart(2, '0')}`;
const [FIRST, SECOND, ELSEWHERE, TARGET, MOVED] = [1, 2, 3, 4, 5].map(task);
const MARKER = { [CLIENT]: { _id: CLIENT, fieldValue: '', revision: 1 } };

const links = () => mockDb.store[SCHEMA_TYPE.CUSTOM_FIELD_LINKS] || [];
const linkOf = (taskId, fieldId) => links().find((doc) => doc.taskId === taskId && doc.fieldId === fieldId);
const storedTask = (id) => mockDb.store[SCHEMA_TYPE.TASKS].find((row) => String(row._id) === id);
const tally = (taskId) => storedTask(taskId).customField[VOTES];
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

beforeEach(() => {
    Object.keys(mockDb.store).forEach((type) => { mockDb.store[type].length = 0; });
    mockDb.calls.length = 0;
    socketEmitter.emit.mockClear();
    [[OWNER, 1], [ADMIN, 2]].forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    [OPEN_PROJECT, OTHER_PROJECT].forEach((_id) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id, ProjectName: _id.slice(-2), isPrivateSpace: false }));
    const row = (_id, ProjectID, extra = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, { _id, ProjectID, sprintId: SPRINT, TaskName: `Task ${_id.slice(-2)}`, TaskKey: `T-${_id.slice(-2)}`, TaskTypeKey: 1, deletedStatusKey: 0, ...extra });
    row(FIRST, OPEN_PROJECT, { customField: { ...MARKER } });
    row(SECOND, OPEN_PROJECT, { customField: { ...MARKER } });
    row(ELSEWHERE, OTHER_PROJECT, { customField: { ...MARKER } });
    row(TARGET, OPEN_PROJECT);
    row(MOVED, OPEN_PROJECT, { customField: { ...MARKER } });
    const field = (id, fieldType) => mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: id, fieldTitle: fieldType, fieldType, type: 'task', global: true, isDelete: true });
    field(CLIENT, 'relationship');
    field(VOTES, 'voting');
    const linked = (taskId, ids) => mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELD_LINKS, { taskId, fieldId: CLIENT, kind: 'relationship', ids });
    linked(FIRST, [TARGET, SECOND]);
    linked(SECOND, []);
    linked(ELSEWHERE, [TARGET]);
    linked(MOVED, [FIRST]);
});

/* Holds back the first write to a task until `release` is called, so a later vote's count can reach the task first. */
const holdingFirstTaskWrite = () => {
    const real = mockDb.crud.getMockImplementation();
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let waiting = true;
    mockDb.crud.mockImplementation(async (companyId, query, method) => {
        if (waiting && query.type === SCHEMA_TYPE.TASKS && method === 'findOneAndUpdate') {
            waiting = false;
            await held;
        }
        return real(companyId, query, method);
    });
    return { release, restore: () => mockDb.crud.mockImplementation(real) };
};

describe('a vote count', () => {
    const vote = (uid, value = true, taskId = FIRST) => castVote({ companyId: CID, uid, taskId, fieldId: VOTES, vote: value });

    it('is the number of voters the vote itself left, with nothing read a second time', async () => {
        expect(await vote(OWNER)).toEqual({ count: 1, voted: true });
        expect(await vote(ADMIN)).toEqual({ count: 2, voted: true });
        expect(linkOf(FIRST, VOTES)).toMatchObject({ kind: 'voting', ids: [OWNER, ADMIN], version: 2 });
        expect(tally(FIRST)).toEqual({ _id: VOTES, fieldValue: 2, revision: expect.any(Number), version: 2 });
        const votesWritten = mockDb.calls.filter((call) => call.type === SCHEMA_TYPE.CUSTOM_FIELD_LINKS);
        expect(votesWritten.map((call) => call.method)).toEqual(['findOneAndUpdate', 'findOneAndUpdate']);
        expect(votesWritten[1].data[1]).toEqual({ $addToSet: { ids: ADMIN }, $inc: { version: 1 }, $setOnInsert: { _id: `${FIRST}:${VOTES}` } });
        expect(linkOf(FIRST, VOTES)._id).toBe(`${FIRST}:${VOTES}`);
    });

    it('stays right when two votes reach the task in the other order', async () => {
        const gate = holdingFirstTaskWrite();
        try {
            const early = vote(OWNER);
            await settle();
            expect(await vote(ADMIN)).toEqual({ count: 2, voted: true });
            expect(tally(FIRST)).toMatchObject({ fieldValue: 2, version: 2 });
            gate.release();
            expect(await early).toEqual({ count: 1, voted: true });
        } finally {
            gate.restore();
        }
        expect(tally(FIRST)).toMatchObject({ fieldValue: 2, version: 2 });
        expect(linkOf(FIRST, VOTES).ids).toEqual([OWNER, ADMIN]);
        expect(socketEmitter.emit).toHaveBeenCalledTimes(1);
    });

    it('stays right when a vote and a withdrawal cross', async () => {
        await vote(OWNER);
        const gate = holdingFirstTaskWrite();
        try {
            const early = vote(ADMIN);
            await settle();
            expect(await vote(OWNER, false)).toEqual({ count: 1, voted: false });
            gate.release();
            expect(await early).toEqual({ count: 2, voted: true });
        } finally {
            gate.restore();
        }
        expect(tally(FIRST)).toMatchObject({ fieldValue: 1, version: 3 });
        expect(linkOf(FIRST, VOTES).ids).toEqual([ADMIN]);
    });

    it('keeps its marker, without a value, when the last vote is withdrawn', async () => {
        await vote(OWNER);
        expect(await vote(OWNER, false)).toEqual({ count: 0, voted: false });
        expect(tally(FIRST)).toEqual({ _id: VOTES, revision: expect.any(Number), version: 2 });
        expect(await vote(OWNER, false, SECOND)).toEqual({ count: 0, voted: false });
        expect(linkOf(SECOND, VOTES)).toBeUndefined();
        expect(storedTask(SECOND).customField[VOTES]).toBeUndefined();
    });

    it('runs the first vote again when another first vote took the insert', async () => {
        const real = mockDb.crud.getMockImplementation();
        let refused = 0;
        mockDb.crud.mockImplementation(async (companyId, query, method) => {
            if (query.type === SCHEMA_TYPE.CUSTOM_FIELD_LINKS && method === 'findOneAndUpdate' && !refused) {
                refused += 1;
                await real(companyId, { type: query.type, data: [query.data[0], { ...query.data[1], $addToSet: { ids: ADMIN } }, query.data[2]] }, method);
                throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
            }
            return real(companyId, query, method);
        });
        try {
            expect(await vote(OWNER)).toEqual({ count: 2, voted: true });
        } finally {
            mockDb.crud.mockImplementation(real);
        }
        expect(linkOf(FIRST, VOTES)).toMatchObject({ ids: [ADMIN, OWNER], version: 2 });
        expect(links().filter((doc) => doc.taskId === FIRST && doc.fieldId === VOTES)).toHaveLength(1);
    });

    it('is declared, with its version, on the strict schemas, and reaches the driver whole', async () => {
        expect(schema.customFieldLinks.version).toMatchObject({ type: Number });
        const votes = realModelStore('customFieldLinksVoteForm', customFieldLinksSchema);
        const tasks = realModelStore('tasksVoteForm', taskSchema);
        mockDb.calls.length = 0;
        const after = await changeVote(CID, { taskId: FIRST, fieldId: VOTES }, OWNER, true);
        await storeTally(CID, after);
        const [voteCall] = mockDb.calls.filter((call) => call.type === SCHEMA_TYPE.CUSTOM_FIELD_LINKS);
        const [taskCall] = mockDb.calls.filter((call) => call.type === SCHEMA_TYPE.TASKS);
        const sentVote = (await votes.driverWrites(voteCall.method, voteCall.data)).writes[0].args;
        expect(sentVote[0]).toEqual({ taskId: FIRST, fieldId: VOTES, kind: 'voting' });
        expect(sentVote[1]).toMatchObject({ $addToSet: { ids: OWNER }, $inc: { version: 1 }, $setOnInsert: { _id: `${FIRST}:${VOTES}` } });
        const sentTask = (await tasks.driverWrites(taskCall.method, taskCall.data)).writes[0].args;
        expect(sentTask[0].$or).toEqual([{ [`customField.${VOTES}.version`]: { $lt: 1 } }, { [`customField.${VOTES}.version`]: { $exists: false } }]);
        expect(sentTask[1].$set[`customField.${VOTES}`]).toEqual({ _id: VOTES, fieldValue: 1, revision: expect.any(Number), version: 1 });
    });
});

describe('the link documents of a task that is gone', () => {
    it('go with it: what its fields held, and its place in other tasks\' relationship fields', async () => {
        await castVote({ companyId: CID, uid: OWNER, taskId: FIRST, fieldId: VOTES, vote: true });
        await removeLinksOfTasks(CID, [FIRST]);
        expect(links().filter((doc) => doc.taskId === FIRST)).toEqual([]);
        expect(linkOf(MOVED, CLIENT).ids).toEqual([]);
        expect(linkOf(ELSEWHERE, CLIENT).ids).toEqual([TARGET]);
        await removeLinksOfTasks(CID, [TARGET, SECOND]);
        expect(linkOf(ELSEWHERE, CLIENT).ids).toEqual([]);
        expect(linkOf(SECOND, CLIENT)).toBeUndefined();
    });

    it('are left alone by an id that names no task', async () => {
        await removeLinksOfTasks(CID, [{ $ne: null }, '', undefined, 'x']);
        await removeLinksOfTasks(CID, []);
        expect(links()).toHaveLength(4);
    });

    it('are found through an index on the linked ids', () => {
        const indexed = customFieldLinksSchema.indexes().map(([fields]) => Object.keys(fields).join(','));
        expect(indexed).toEqual(expect.arrayContaining(['taskId,fieldId', 'fieldId,ids', 'fieldId,kind', 'ids']));
    });
});

describe('"has a value" in a query that keeps to some projects', () => {
    const project = (id) => new mongoose.Types.ObjectId(id);
    const set = { _id: { fieldLinks: { field: CLIENT, is: 'set' } } };
    const answered = async (match) => {
        mockDb.calls.length = 0;
        const [stage] = await withLinkConditions(CID, OWNER, [{ $match: match }]);
        const found = [stage.$match, ...(stage.$match.$and || [])].find((part) => part._id)._id;
        const read = mockDb.calls.filter((call) => call.type === SCHEMA_TYPE.CUSTOM_FIELD_LINKS && call.method === 'find').map((call) => call.data[0]);
        return { ids: Object.values(found)[0].map(String), read };
    };

    it('reads the links of the tasks that carry the field in those projects, and no others', async () => {
        const { ids, read } = await answered({ $and: [{ ProjectID: { $in: [project(OPEN_PROJECT)] } }, { deletedStatusKey: 0 }, set] });
        expect(ids).toEqual([FIRST, MOVED]);
        expect(read).toEqual([{ fieldId: CLIENT, kind: 'relationship', 'ids.0': { $exists: true }, taskId: { $in: [FIRST, SECOND, MOVED] } }]);
        expect((await answered({ ProjectID: project(OTHER_PROJECT), ...set })).ids).toEqual([ELSEWHERE]);
        expect((await answered({ ProjectID: { $in: [project(OPEN_PROJECT), project(OTHER_PROJECT)] }, ...set })).ids).toEqual([FIRST, ELSEWHERE, MOVED]);
    });

    it('follows a task to the project it was moved to', async () => {
        storedTask(MOVED).ProjectID = OTHER_PROJECT;
        expect((await answered({ ProjectID: project(OTHER_PROJECT), ...set })).ids).toEqual([ELSEWHERE, MOVED]);
        expect((await answered({ ProjectID: project(OPEN_PROJECT), ...set })).ids).toEqual([FIRST]);
    });

    it('reads no link at all for a project where no task carries the field', async () => {
        mockDb.store[SCHEMA_TYPE.TASKS].forEach((row) => { if (String(row.ProjectID) === OTHER_PROJECT) delete row.customField; });
        const { ids, read } = await answered({ ProjectID: project(OTHER_PROJECT), ...set });
        expect(ids).toEqual([]);
        expect(read).toEqual([]);
    });

    it.each([
        ['names no project', { deletedStatusKey: 0 }],
        ['names projects only as one of several choices', { $or: [{ ProjectID: project(OPEN_PROJECT) }, { sprintId: SPRINT }] }],
        ['rules a project out instead of naming one', { ProjectID: { $nin: [project(OTHER_PROJECT)] } }],
        ['names more projects than it bounds', { ProjectID: { $in: Array.from({ length: 51 }, () => project(OPEN_PROJECT)) } }],
    ])('reads the field across the company when the query %s', async (_what, match) => {
        const { ids, read } = await answered({ ...match, ...set });
        expect(ids).toEqual([FIRST, ELSEWHERE, MOVED]);
        expect(read).toEqual([{ fieldId: CLIENT, kind: 'relationship', 'ids.0': { $exists: true } }]);
    });

    it('takes the fewest projects any required part of the query names', async () => {
        const { ids } = await answered({ $and: [{ ProjectID: { $in: [project(OPEN_PROJECT), project(OTHER_PROJECT)] } }, { $and: [{ ProjectID: project(OTHER_PROJECT) }] }, set] });
        expect(ids).toEqual([ELSEWHERE]);
    });
});

describe('a list grouped by a relationship field, read again when its tab comes back', () => {
    const group = (is) => ({ indexName: 'groupByStatusIndex', searchKey: `customField.${CLIENT}.fieldValue`, searchValue: is, conditions: [{ _id: { fieldLinks: { field: CLIENT, is } } }] });
    const tabReturn = async (is) => {
        mockDb.calls.length = 0;
        const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(sent) { this.body = sent; return this; } };
        await getTabSyncTasks({ uid: OWNER, headers: { companyid: CID }, body: { pid: OPEN_PROJECT, sprintId: SPRINT, istableTask: false, tabLeaveTime: 0, userId: OWNER, item: group(is) } }, res);
        const facet = mockDb.calls.filter((call) => call.type === SCHEMA_TYPE.TASKS && call.method === 'aggregate')
            .flatMap((call) => call.data[0]).find((stage) => stage.$facet).$facet;
        const [operator, ids] = Object.entries(facet.count[0].$match.$and[1]._id)[0];
        const read = mockDb.calls.filter((call) => call.type === SCHEMA_TYPE.CUSTOM_FIELD_LINKS && call.method === 'find').map((call) => call.data[0]);
        return { code: res.statusCode, operator, ids: Array.isArray(ids) ? ids.map(String) : ids, read };
    };

    it('asks the database for the tasks that hold a link, read from this project alone', async () => {
        const { code, operator, ids, read } = await tabReturn('set');
        expect({ code, operator, ids }).toEqual({ code: 200, operator: '$in', ids: [FIRST, MOVED] });
        expect(read).toEqual([{ fieldId: CLIENT, kind: 'relationship', 'ids.0': { $exists: true }, taskId: { $in: [FIRST, SECOND, MOVED] } }]);
    });

    it('asks for every other task in the group with no value', async () => {
        expect(await tabReturn('empty')).toMatchObject({ code: 200, operator: '$nin', ids: [FIRST, MOVED] });
    });
});

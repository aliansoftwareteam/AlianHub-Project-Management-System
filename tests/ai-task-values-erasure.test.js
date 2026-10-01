const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/config', () => {
    const NodeCache = require('node-cache');
    return { myCache: new NodeCache() };
});
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../common-storage/readStoredFile', () => ({ readStoredFile: jest.fn() }));
jest.mock('../Modules/Agents/budget', () => ({ settings: jest.fn(async () => ({ monthlyBudgetUsd: 25 })) }));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const controls = require('../Modules/Knowledge/controls');

/* Kept AI values are derived from task and comment text, so the erasures of the Knowledge console reach them. */

const C = '6f0000000000000000000c01';
const ALICE = '6f0000000000000000000011';
const BOB = '6f0000000000000000000012';
const TASK = '6f0000000000000000000b01';
const OTHER = '6f0000000000000000000b02';
const VALUES = SCHEMA_TYPE.TASK_AI_VALUES;

const oid = (id) => new mongoose.Types.ObjectId(id);
const value = (taskId, kind, madeBy) => mockDb.seed(VALUES, { taskId, kind, value: kind === 'summary' ? 'A summary' : { category: 'Bug' }, basis: '1', madeAt: new Date(), madeBy });
const left = () => (mockDb.store[VALUES] || []).map((row) => `${row.taskId}:${row.kind}`).sort();

beforeEach(() => { Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; }); });

describe('erasure by person', () => {
    it('removes the values the person asked for and the summaries of threads they wrote in, and counts them', async () => {
        value(TASK, 'summary', BOB);
        value(TASK, 'category', BOB);
        value(OTHER, 'summary', ALICE);
        value(OTHER, 'category', BOB);
        mockDb.seed(SCHEMA_TYPE.COMMENTS, { taskId: oid(TASK), userId: ALICE, message: 'Mine', type: 'text' });

        const result = await controls.erasePerson(C, ALICE);

        expect(result.removed.ai_task_value).toBe(2);
        expect(left()).toEqual([`${OTHER}:category`, `${TASK}:category`].sort());
    });

    it('finds a person who left nothing but a kept value', async () => {
        expect(await controls.personExists(C, ALICE)).toBe(false);
        value(TASK, 'category', ALICE);
        expect(await controls.personExists(C, ALICE)).toBe(true);
    });
});

describe('erasure of a document', () => {
    it('of a task removes both of its kept values', async () => {
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: oid(TASK), TaskName: 'Fix login', deletedStatusKey: 0 });
        value(TASK, 'summary', BOB);
        value(TASK, 'category', BOB);
        value(OTHER, 'summary', BOB);

        await controls.eraseDocument(C, { sourceType: 'task', sourceId: TASK });

        expect(left()).toEqual([`${OTHER}:summary`]);
    });

    it('of a comment removes the summary of the thread it was in', async () => {
        const comment = mockDb.seed(SCHEMA_TYPE.COMMENTS, { _id: oid('6f0000000000000000000d01'), taskId: oid(TASK), userId: ALICE, message: 'Mine', type: 'text' });
        value(TASK, 'summary', BOB);
        value(TASK, 'category', BOB);

        await controls.eraseDocument(C, { sourceType: 'comment', sourceId: String(comment._id) });

        expect(left()).toEqual([`${TASK}:category`]);
    });
});

const mockDb = require('./fixtures/fakeMongo').create();
const mockChat = jest.fn();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));
jest.mock('../utils/companyMembers', () => ({ memberProfiles: jest.fn(() => Promise.resolve([])) }));
jest.mock('../Modules/AICore/llmProvider', () => ({
    isAnyProviderConfigured: () => true,
    getProvider: () => ({ name: 'fake', chat: (...a) => mockChat(...a) }),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { schema } = require('../utils/mongo-handler/schema');
const scope = require('../Modules/Agents/scope');
const { myCache } = require('../Config/config');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const PRIYA = '6f0000000000000000000002';
const OPEN = '6f0000000000000000000a01';
const HIDDEN = '6f0000000000000000000a02';
const TASK = '6f0000000000000000000b01';
const OTHER = '6f0000000000000000000b02';
const SECRET = '6f0000000000000000000b03';
const VALUES = SCHEMA_TYPE.TASK_AI_VALUES;

const oid = (id) => new mongoose.Types.ObjectId(id);
const kept = () => mockDb.store[VALUES] || [];
const keptOf = (taskId, kind) => kept().find((row) => row.taskId === taskId && row.kind === kind);

const seedTask = (id, projectId, over = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    _id: oid(id), TaskName: 'Fix the login page', rawDescription: 'People cannot sign in', ProjectID: projectId, deletedStatusKey: 0, ...over,
});
const seedComment = (taskId, userId = ME, over = {}) => mockDb.seed(SCHEMA_TYPE.COMMENTS, {
    taskId: oid(taskId), userId, message: 'Shipping on Friday', type: 'text', createdAt: new Date(), ...over,
});

/* A new process: nothing the modules held in memory is left, only what the store keeps. */
const restart = () => {
    myCache.flushAll();
    let fresh;
    jest.isolateModules(() => {
        fresh = {
            summary: require('../Modules/AI/taskSummary'),
            category: require('../Modules/AI/taskCategory'),
            values: require('../Modules/AI/taskValues'),
            store: require('../Modules/AI/taskAiValues'),
        };
    });
    return fresh;
};

const res = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.send = (body) => { r.body = body; return r; };
    return r;
};
const readKept = async (app, { uid = ME, taskIds = [TASK], kinds = ['summary', 'category'], apiToken } = {}) => {
    const out = res();
    await app.values.keptValues({ uid, headers: { companyid: C }, body: { taskIds, kinds }, apiToken }, out);
    return out;
};

let app;

beforeEach(() => {
    Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; });
    jest.clearAllMocks();
    scope.visibleProjectIds.mockImplementation(async (companyId, uid) => (uid === ME ? [OPEN] : [OPEN, HIDDEN]));
    mockChat.mockImplementation(async ({ jsonMode, messages }) => (messages[0].content.includes('Labels')
        ? { content: '{"category":"Bug","confidence":0.9,"reason":"a defect"}' }
        : { content: jsonMode ? '{"summary":"Shipping on Friday."}' : '' }));
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(OPEN), ProjectName: 'Web', tagsArray: [{ tagName: 'Bug' }, { tagName: 'Feature' }] });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(HIDDEN), ProjectName: 'HR', tagsArray: [{ tagName: 'Bug' }] });
    seedTask(TASK, OPEN);
    seedTask(OTHER, OPEN, { TaskName: 'Write the changelog' });
    seedTask(SECRET, HIDDEN);
    seedComment(TASK);
    seedComment(TASK, PRIYA);
    app = restart();
});

describe('the kept AI value collection', () => {
    it('is registered and declares every field a kept value stores, so the strict schema drops none', () => {
        expect(VALUES).toBe('task_ai_values');
        const { dbCollections } = require('../Config/collections');
        expect(dbCollections.TASK_AI_VALUES).toBe('task_ai_values');
        const { checkType, tableType } = jest.requireActual('../utils/mongo-handler/mongoQueries');
        const createSchema = require('../utils/mongo-handler/createSchema');
        expect(checkType(VALUES)).toBe(createSchema.taskAiValuesSchema);
        expect(tableType(VALUES)).toBe('task_ai_values');
        expect(createSchema.taskAiValuesSchema.options.strict).toBe(true);
        expect(createSchema.taskAiValuesSchema.indexes().some(([fields, options]) => options.unique && Object.keys(fields).join() === 'taskId,kind')).toBe(true);
        ['taskId', 'kind', 'value', 'basis', 'madeAt', 'madeBy'].forEach((field) => expect(Object.keys(schema.taskAiValues)).toContain(field));
    });

    it('is never a knowledge source', () => {
        const indexer = require('../Modules/Knowledge/ingest/indexer');
        const collections = Object.values(indexer.RULES).map((rule) => rule.collection).filter(Boolean);
        expect(collections.length).toBeGreaterThan(0);
        expect(collections).not.toContain(VALUES);
    });
});

describe('a task summary is kept in the store', () => {
    it('with what it was made from, when and by whom', async () => {
        const made = await app.summary.summarizeTask({ companyId: C, uid: ME, taskId: TASK });
        expect(made.data).toMatchObject({ summary: 'Shipping on Friday.', commentCount: 2, summaryCount: 2, cached: false });
        expect(keptOf(TASK, 'summary')).toMatchObject({ value: 'Shipping on Friday.', basis: '2', madeBy: ME });
        expect(keptOf(TASK, 'summary').madeAt).toBeInstanceOf(Date);
        Object.keys(keptOf(TASK, 'summary')).forEach((field) => expect([...Object.keys(schema.taskAiValues), '_id']).toContain(field));
    });

    it('survives a restart: the next read comes from the store and calls no model', async () => {
        await app.summary.summarizeTask({ companyId: C, uid: ME, taskId: TASK });
        const later = restart();

        const again = await later.summary.summarizeTask({ companyId: C, uid: PRIYA, taskId: TASK });
        const opened = await later.summary.summarizeTask({ companyId: C, uid: PRIYA, taskId: TASK, keptOnly: true });
        expect(mockChat).toHaveBeenCalledTimes(1);
        expect(again.data).toMatchObject({ summary: 'Shipping on Friday.', cached: true, stale: false });
        expect(opened.data).toMatchObject({ summary: 'Shipping on Friday.', commentCount: 2, summaryCount: 2, stale: false });
        expect(kept()).toHaveLength(1);
    });

    it('is handed back marked as behind when the thread has moved on, and is written again only on request', async () => {
        await app.summary.summarizeTask({ companyId: C, uid: ME, taskId: TASK });
        seedComment(TASK, PRIYA, { message: 'Slipping to Monday' });

        const opened = await app.summary.summarizeTask({ companyId: C, uid: ME, taskId: TASK, keptOnly: true });
        expect(opened.data).toMatchObject({ summary: 'Shipping on Friday.', commentCount: 3, summaryCount: 2, stale: true });
        expect(opened.data.pending).toBeUndefined();
        expect(mockChat).toHaveBeenCalledTimes(1);

        await app.summary.summarizeTask({ companyId: C, uid: PRIYA, taskId: TASK, force: true });
        expect(mockChat).toHaveBeenCalledTimes(2);
        expect(keptOf(TASK, 'summary')).toMatchObject({ basis: '3', madeBy: PRIYA });
        expect(kept()).toHaveLength(1);
    });

    it('says nothing is kept for a thread nobody has summarised', async () => {
        const opened = await app.summary.summarizeTask({ companyId: C, uid: ME, taskId: TASK, keptOnly: true });
        expect(opened.data).toMatchObject({ summary: '', commentCount: 2, pending: true });
        expect(mockChat).not.toHaveBeenCalled();
    });
});

describe('a task area is kept in the store', () => {
    it('with the fingerprint of the task and labels it was filed from, and is read back after a restart', async () => {
        const made = await app.category.categoriseTask({ companyId: C, uid: ME, taskId: TASK });
        expect(made.data).toMatchObject({ category: 'Bug', source: 'tag', cached: false });
        expect(keptOf(TASK, 'category')).toMatchObject({ value: expect.objectContaining({ category: 'Bug', source: 'tag' }), madeBy: ME });
        expect(keptOf(TASK, 'category').basis).toMatch(/^[a-f0-9]{16}$/);

        const later = restart();
        const again = await later.category.categoriseTask({ companyId: C, uid: PRIYA, taskId: TASK });
        expect(again.data).toMatchObject({ category: 'Bug', cached: true });
        expect(mockChat).toHaveBeenCalledTimes(1);
    });

    it('keeps "no label fits" too, so a task that fits nothing is not asked about again', async () => {
        mockChat.mockResolvedValue({ content: '{"category":null,"confidence":0.2,"reason":"nothing fits"}' });
        await app.category.categoriseTask({ companyId: C, uid: ME, taskId: TASK });
        const again = await restart().category.categoriseTask({ companyId: C, uid: ME, taskId: TASK });
        expect(again.data).toMatchObject({ category: null, reason: 'nothing fits', cached: true });
        expect(mockChat).toHaveBeenCalledTimes(1);
    });
});

describe('reading the kept values of the rows a table shows', () => {
    const fill = async () => {
        await app.summary.summarizeTask({ companyId: C, uid: ME, taskId: TASK });
        await app.category.categoriseTask({ companyId: C, uid: ME, taskId: TASK });
        seedComment(SECRET, PRIYA);
        await app.summary.summarizeTask({ companyId: C, uid: PRIYA, taskId: SECRET });
        await app.category.categoriseTask({ companyId: C, uid: PRIYA, taskId: SECRET });
        mockChat.mockClear();
    };

    it('answers each task\'s kept summary and area in one request, and never calls the model', async () => {
        await fill();
        const out = await readKept(restart(), { taskIds: [TASK, OTHER] });
        expect(out.body.status).toBe(true);
        expect(out.body.data.values[TASK].summary).toMatchObject({ summary: 'Shipping on Friday.', commentCount: 2, summaryCount: 2, stale: false, madeBy: ME });
        expect(out.body.data.values[TASK].category).toMatchObject({ category: 'Bug', source: 'tag', stale: false });
        expect(typeof out.body.data.values[TASK].summary.updatedAt).toBe('string');
        expect(out.body.data.values[OTHER]).toBeUndefined();
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('marks a value whose source has changed since, without regenerating it', async () => {
        await fill();
        seedComment(TASK, PRIYA);
        mockDb.store[SCHEMA_TYPE.TASKS].find((t) => String(t._id) === TASK).TaskName = 'Redesign the login page';
        const out = await readKept(app);
        expect(out.body.data.values[TASK].summary).toMatchObject({ stale: true, commentCount: 3, summaryCount: 2 });
        expect(out.body.data.values[TASK].category).toMatchObject({ category: 'Bug', stale: true });
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('gives a reader nothing for a task they cannot open', async () => {
        await fill();
        const mine = await readKept(app, { uid: ME, taskIds: [TASK, SECRET] });
        expect(Object.keys(mine.body.data.values)).toEqual([TASK]);
        expect(JSON.stringify(mine.body)).not.toContain(SECRET);

        const theirs = await readKept(app, { uid: PRIYA, taskIds: [TASK, SECRET] });
        expect(Object.keys(theirs.body.data.values).sort()).toEqual([TASK, SECRET]);
    });

    it('gives nothing for a task in the trash', async () => {
        await fill();
        mockDb.store[SCHEMA_TYPE.TASKS].find((t) => String(t._id) === TASK).deletedStatusKey = 1;
        expect((await readKept(app)).body.data.values).toEqual({});
    });

    it('reads only the kinds asked for, ignores ids that are not ids, and refuses more rows than a table asks for at once', async () => {
        await fill();
        const one = await readKept(app, { kinds: ['category'] });
        expect(Object.keys(one.body.data.values[TASK])).toEqual(['category']);
        expect((await readKept(app, { taskIds: ['nope', { $ne: 1 }, TASK], kinds: ['summary', 'everything'] })).body.data.values[TASK].summary.summary).toBe('Shipping on Friday.');

        const many = Array.from({ length: 201 }, (_, i) => (i + 1).toString(16).padStart(24, '0'));
        const refused = await readKept(app, { taskIds: many });
        expect(refused.statusCode).toBe(400);
        expect((await readKept(app, { uid: '' })).statusCode).toBe(401);
    });

    it('is registered behind the sign-in guard', () => {
        const routes = [];
        const fake = new Proxy({}, { get: (_, method) => (path) => routes.push(`${String(method).toUpperCase()} ${path}`) });
        require('../Modules/AI/routes').init(fake);
        expect(routes).toContain('POST /api/v1/ai/task-values');
        const guarded = require('fs').readFileSync(require('path').join(__dirname, '..', 'Config', 'setMiddleware.js'), 'utf8');
        expect(guarded).toMatch(/['"]\/api\/v1\/ai\/task-values['"]/);
    });
});

describe('kept values follow the content they were made from', () => {
    const fill = async () => {
        await app.summary.summarizeTask({ companyId: C, uid: ME, taskId: TASK });
        await app.category.categoriseTask({ companyId: C, uid: ME, taskId: TASK });
        seedComment(OTHER, PRIYA);
        await app.summary.summarizeTask({ companyId: C, uid: PRIYA, taskId: OTHER });
    };

    it('both go when the task goes to the trash, and a restored task starts without them', async () => {
        await fill();
        await app.store.onTaskEnvelope({ companyId: C, type: 'task.updated', entity: { kind: 'task', id: TASK }, changedFields: ['status'] });
        expect(kept()).toHaveLength(3);

        mockDb.store[SCHEMA_TYPE.TASKS].find((t) => String(t._id) === TASK).deletedStatusKey = 1;
        await app.store.onTaskEnvelope({ companyId: C, type: 'task.updated', entity: { kind: 'task', id: TASK }, changedFields: ['deletedStatusKey'] });
        expect(kept().map((row) => row.taskId)).toEqual([OTHER]);
    });

    it('are kept when the task is archived or restored', async () => {
        await fill();
        mockDb.store[SCHEMA_TYPE.TASKS].find((t) => String(t._id) === TASK).deletedStatusKey = 2;
        await app.store.onTaskEnvelope({ companyId: C, type: 'task.updated', entity: { kind: 'task', id: TASK }, changedFields: ['deletedStatusKey'] });
        expect(kept()).toHaveLength(3);
    });

    it('the summary goes when a comment it was made from is deleted, and the area stays', async () => {
        await fill();
        await app.store.onCommentEnvelope({ companyId: C, type: 'comment.updated', data: { taskId: TASK, isDeleted: false } });
        expect(kept()).toHaveLength(3);
        await app.store.onCommentEnvelope({ companyId: C, type: 'comment.deleted', data: { taskId: TASK, isDeleted: true } });
        expect(kept().map((row) => `${row.taskId}:${row.kind}`).sort()).toEqual([`${TASK}:category`, `${OTHER}:summary`].sort());
    });

    it('a person\'s erasure removes what they asked for and every summary of a thread they wrote in', async () => {
        await fill();
        expect(await app.store.hasValues(C, PRIYA)).toBe(true);
        const removed = await app.store.erasePerson(C, PRIYA);
        expect(removed).toBe(2);
        expect(kept().map((row) => `${row.taskId}:${row.kind}`)).toEqual([`${TASK}:category`]);
        await expect(app.store.erasePerson(C, 'everyone')).rejects.toThrow(/valid user id/);
    });

    it('a task\'s erasure removes both of its values', async () => {
        await fill();
        expect(await app.store.forgetTask(C, TASK)).toBe(2);
        expect(kept().map((row) => row.taskId)).toEqual([OTHER]);
    });
});

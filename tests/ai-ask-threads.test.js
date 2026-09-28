const mockDbs = {};
const mockDbFor = (companyId) => {
    const id = String(companyId);
    if (!mockDbs[id]) mockDbs[id] = require('./fixtures/fakeMongo').create();
    return mockDbs[id];
};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(companyId).crud(companyId, q, method) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjects: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 3), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Knowledge/flag', () => ({ enabledFor: jest.fn(async () => false) }));
jest.mock('../Modules/Knowledge/askSources', () => ({ askSources: jest.fn() }));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { schema } = require('../utils/mongo-handler/schema');
const { visibleProjects } = require('../Modules/Agents/scope');
const { getProvider, isAnyProviderConfigured } = require('../Modules/AICore/llmProvider');
const { FEATURES } = require('../Modules/AICore/features');
const threads = require('../Modules/AI/askThreads');
const { askStream } = require('../Modules/AI/askStream');
const { holdNarrowedToken } = require('../Config/narrowedTokenRoutes');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const ALICE = '6f0000000000000000000011';
const BOB = '6f0000000000000000000012';
const OPS = '6f0000000000000000000a01';
const HR = '6f0000000000000000000a02';
const THREADS = SCHEMA_TYPE.ASK_THREADS;

const db = (companyId = C) => mockDbFor(companyId);
const stored = (companyId = C) => db(companyId).store[THREADS] || [];

const jsonRes = () => {
    const res = { statusCode: 200 };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.send = jest.fn((body) => { res.body = body; return res; });
    res.json = res.send;
    return res;
};

const sseRes = () => {
    const res = jsonRes();
    const listeners = {};
    Object.assign(res, {
        headers: {},
        chunks: [],
        writableEnded: false,
        setHeader: (key, value) => { res.headers[key.toLowerCase()] = value; },
        flushHeaders: jest.fn(),
        write: jest.fn((chunk) => { res.chunks.push(String(chunk)); return true; }),
        end: jest.fn(() => { res.writableEnded = true; (listeners.close || []).forEach((fn) => fn()); }),
        on: (event, fn) => { (listeners[event] = listeners[event] || []).push(fn); return res; },
        hangUp: () => (listeners.close || []).forEach((fn) => fn()),
    });
    return res;
};

const eventsOf = (res) => res.chunks.join('').split('\n\n')
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice('data: '.length)));

const request = ({ uid = ALICE, companyId = C, params = {}, body = {}, apiToken } = {}) => ({ headers: { companyid: companyId }, uid, params, body, apiToken, query: {} });

const call = async (handler, options) => {
    const res = jsonRes();
    await handler(request(options), res);
    return res;
};

const stream = async (options, prepare) => {
    const res = sseRes();
    if (prepare) prepare(res);
    await askStream(request(options), res);
    return res;
};

const seedTask = (projectId, over = {}) => db().seed(SCHEMA_TYPE.TASKS, {
    TaskName: 'Budget review', TaskKey: 'OPS-1', statusType: 'open', ProjectID: projectId, deletedStatusKey: 0, updatedAt: new Date('2026-09-01T00:00:00Z'), ...over,
});

const seedThread = (over = {}) => db(over.companyId || C).seed(THREADS, {
    ownerId: ALICE,
    title: 'What is the budget?',
    turns: [{ turnId: '6f00000000000000000000f1', question: 'What is the budget?', answer: 'It is 12k [OPS-1].', mode: 'ask', model: 'm-1', cited: [], createdAt: new Date('2026-09-20T00:00:00Z') }],
    turnCount: 1,
    lastTurnAt: new Date('2026-09-20T00:00:00Z'),
    ...over,
});

const answering = (content, { deltas } = {}) => {
    const chat = jest.fn(async (opts) => {
        if (deltas && typeof opts.onText === 'function') deltas.forEach((delta) => opts.onText(delta));
        return { content, totalTokens: 42, model: 'm-1' };
    });
    getProvider.mockReturnValue({ chat });
    return chat;
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    jest.clearAllMocks();
    isAnyProviderConfigured.mockReturnValue(true);
    require('../Config/permissionGuard').getRoleType.mockResolvedValue(3);
    visibleProjects.mockResolvedValue([{ _id: OPS, ProjectName: 'Ops' }]);
});

describe('the ask thread collection', () => {
    it('is registered and declares every field a thread and a turn store, so the strict schema drops none', () => {
        expect(THREADS).toBe('ask_threads');
        const { dbCollections } = require('../Config/collections');
        expect(dbCollections.ASK_THREADS).toBe('ask_threads');
        const { checkType, tableType } = jest.requireActual('../utils/mongo-handler/mongoQueries');
        const createSchema = require('../utils/mongo-handler/createSchema');
        expect(checkType(THREADS)).toBe(createSchema.askThreadsSchema);
        expect(tableType(THREADS)).toBe('ask_threads');
        expect(createSchema.askThreadsSchema.options.strict).toBe(true);

        const declared = Object.keys(schema.askThreads);
        ['ownerId', 'title', 'turns', 'turnCount', 'lastTurnAt'].forEach((field) => expect(declared).toContain(field));
        const turn = schema.askThreads.turns.type[0];
        ['turnId', 'question', 'answer', 'mode', 'model', 'cited', 'createdAt'].forEach((field) => expect(Object.keys(turn)).toContain(field));
        ['kind', 'sourceId', 'ref'].forEach((field) => expect(Object.keys(turn.cited.type[0])).toContain(field));
    });

    it('states its limits', () => {
        expect(threads.LIMITS).toMatchObject({ THREADS: 50, TURNS: 30, CONTEXT_TURNS: 6 });
    });
});

describe('thread routes are private to their owner', () => {
    it('lists only my threads, newest first, without their turns', async () => {
        seedThread({ title: 'older', lastTurnAt: new Date('2026-09-01T00:00:00Z') });
        seedThread({ title: 'newer', lastTurnAt: new Date('2026-09-10T00:00:00Z') });
        seedThread({ ownerId: BOB, title: 'bobs' });

        const res = await call(threads.listThreads);

        expect(res.body.status).toBe(true);
        expect(res.body.data.threads.map((t) => t.title)).toEqual(['newer', 'older']);
        expect(res.body.data.threads[0]).toEqual({ id: expect.any(String), title: 'newer', turns: 1, lastTurnAt: expect.any(Date) });
    });

    it('never shows, renames or deletes another person\'s thread, admins included', async () => {
        const bobs = seedThread({ ownerId: BOB, title: 'bobs' });
        const id = String(bobs._id);
        require('../Config/permissionGuard').getRoleType.mockResolvedValue(1);

        expect((await call(threads.getThread, { params: { id } })).statusCode).toBe(404);
        expect((await call(threads.renameThread, { params: { id }, body: { title: 'mine now' } })).statusCode).toBe(404);
        const removed = await call(threads.deleteThread, { params: { id } });
        expect(removed.statusCode).toBe(404);
        expect(removed.body).toMatchObject({ status: false, code: 'thread_not_found' });
        expect(stored().map((t) => t.title)).toEqual(['bobs']);
    });

    it('opens, renames and deletes my own thread', async () => {
        const mine = seedThread();
        const id = String(mine._id);

        const opened = await call(threads.getThread, { params: { id } });
        expect(opened.body.data).toMatchObject({ id, title: 'What is the budget?' });
        expect(opened.body.data.turns[0]).toMatchObject({ turnId: '6f00000000000000000000f1', question: 'What is the budget?', answer: 'It is 12k [OPS-1].', model: 'm-1' });

        expect((await call(threads.renameThread, { params: { id }, body: { title: '  Budget  ' } })).body.status).toBe(true);
        expect(stored()[0].title).toBe('Budget');
        expect((await call(threads.renameThread, { params: { id }, body: { title: '  ' } })).body).toMatchObject({ status: false, code: 'title_required' });

        expect((await call(threads.deleteThread, { params: { id } })).body.status).toBe(true);
        expect(stored()).toEqual([]);
    });

    it('keeps each workspace\'s threads in its own database', async () => {
        const mine = seedThread();
        const res = await call(threads.getThread, { params: { id: String(mine._id) }, companyId: OTHER_COMPANY });
        expect(res.statusCode).toBe(404);
        expect((await call(threads.listThreads, { companyId: OTHER_COMPANY })).body.data.threads).toEqual([]);
        expect(db(OTHER_COMPANY).calls.every((c) => c.companyId === OTHER_COMPANY)).toBe(true);
    });

    it('refuses a caller without a company or a user, and an id that is not one', async () => {
        expect((await call(threads.listThreads, { uid: '' })).body).toMatchObject({ status: false, code: 'unauthenticated' });
        expect((await call(threads.getThread, { params: { id: 'nope' } })).statusCode).toBe(404);
    });

    it('re-reads what a stored answer cited, and names only what I can still open', async () => {
        const task = seedTask(OPS, { TaskName: 'Budget review' });
        const hidden = seedTask(HR, { TaskName: 'Salary bands', TaskKey: 'HR-1' });
        const mine = seedThread({
            turns: [{ turnId: 't1', question: 'q', answer: 'a [OPS-1] [HR-1]', mode: 'ask', model: 'm-1', createdAt: new Date(),
                cited: [{ kind: 'task', sourceId: String(task._id), ref: 'OPS-1' }, { kind: 'task', sourceId: String(hidden._id), ref: 'HR-1' }] }],
        });

        const res = await call(threads.getThread, { params: { id: String(mine._id) } });

        expect(res.body.data.turns[0].cited).toEqual([
            { kind: 'task', id: String(task._id), ref: 'OPS-1', title: 'Budget review', project: 'Ops', projectId: OPS, available: true },
            { kind: 'task', id: String(hidden._id), ref: 'HR-1', title: '', project: '', projectId: '', available: false },
        ]);
    });
});

describe('a token narrowed to projects cannot read threads', () => {
    const narrowed = { _id: 'tok1', userId: ALICE, projectIds: [OPS] };

    it('is refused by every thread handler', async () => {
        const mine = seedThread();
        const id = String(mine._id);
        for (const [handler, params] of [[threads.listThreads, {}], [threads.getThread, { id }], [threads.deleteThread, { id }], [threads.renameThread, { id }]]) {
            const res = await call(handler, { params, apiToken: narrowed, body: { title: 'x' } });
            expect(res.statusCode).toBe(403);
            expect(res.body).toMatchObject({ status: false, code: 'token_limited_to_projects' });
        }
        expect(stored()).toHaveLength(1);
        const streamed = await stream({ apiToken: narrowed, body: { question: 'budget', threadId: id } });
        expect(streamed.statusCode).toBe(403);
    });

    it('is refused by the route guard before a handler runs', async () => {
        const guarded = async (method, path) => {
            const res = jsonRes();
            const next = jest.fn();
            await holdNarrowedToken({ method, originalUrl: path, apiToken: narrowed, headers: { companyid: C } }, res, next);
            return next.mock.calls.length ? 'reached' : res.statusCode;
        };
        expect(await guarded('GET', '/api/v1/ai/ask/threads')).toBe(403);
        expect(await guarded('GET', '/api/v1/ai/ask/threads/6f0000000000000000000001')).toBe(403);
        expect(await guarded('DELETE', '/api/v1/ai/ask/threads/6f0000000000000000000001')).toBe(403);
        expect(await guarded('POST', '/api/v1/ai/ask/stream')).toBe(403);
    });
});

describe('the streamed answer', () => {
    it('sends the tokens as they come, then one final event with the citations, model and turn', async () => {
        const task = seedTask(OPS);
        const chat = answering('Budget is 12k [OPS-1].', { deltas: ['Budget is ', '12k [OPS-1].'] });

        const res = await stream({ body: { question: 'what is the budget' } });

        expect(res.headers['content-type']).toMatch(/text\/event-stream/);
        const events = eventsOf(res);
        expect(events.slice(0, 2)).toEqual([{ event: 'token', text: 'Budget is ' }, { event: 'token', text: '12k [OPS-1].' }]);
        const done = events[events.length - 1];
        expect(done).toMatchObject({
            event: 'done',
            threadId: expect.any(String),
            turnId: expect.any(String),
            answer: 'Budget is 12k [OPS-1].',
            mode: 'ask',
            configured: true,
            usage: { tokens: 42, model: 'm-1' },
            scope: { projects: 1, privileged: false },
        });
        expect(done.cited.map((s) => s.id)).toEqual([String(task._id)]);
        expect(res.end).toHaveBeenCalled();
        expect(chat.mock.calls[0][0].spend).toEqual({ feature: FEATURES.ASK, companyId: C, userId: ALICE });
    });

    it('sends the whole answer as tokens when the provider cannot stream', async () => {
        seedTask(OPS);
        answering('Budget is 12k [OPS-1].');

        const events = eventsOf(await stream({ body: { question: 'what is the budget' } }));

        const tokens = events.filter((e) => e.event === 'token').map((e) => e.text).join('');
        expect(tokens).toBe('Budget is 12k [OPS-1].');
        expect(events[events.length - 1].event).toBe('done');
    });

    it('stores the turn for the asker with only the ids of what it cited', async () => {
        const task = seedTask(OPS);
        answering('Budget is 12k [OPS-1].');

        const done = eventsOf(await stream({ body: { question: 'what is the budget' } })).pop();

        expect(stored()).toHaveLength(1);
        const thread = stored()[0];
        expect(String(thread._id)).toBe(done.threadId);
        expect(thread).toMatchObject({ ownerId: ALICE, title: 'what is the budget', turnCount: 1 });
        expect(thread.turns).toEqual([{
            turnId: done.turnId, question: 'what is the budget', answer: 'Budget is 12k [OPS-1].', mode: 'ask', model: 'm-1',
            cited: [{ kind: 'task', sourceId: String(task._id), ref: 'OPS-1' }], createdAt: expect.any(Date),
        }]);
    });

    it('says why when there is nothing to answer from, stores nothing and leaves the stream unopened', async () => {
        answering('unused');
        const empty = await stream({ body: { question: 'what is the budget' } });
        expect(empty.body).toMatchObject({ status: true, data: { answer: '', emptyCode: 'no_match' } });

        isAnyProviderConfigured.mockReturnValue(false);
        seedTask(OPS);
        const off = await stream({ body: { question: 'what is the budget' } });
        expect(off.body).toMatchObject({ status: true, data: { configured: false } });
        expect(off.body.data.sources).toHaveLength(1);

        expect((await stream({ body: { question: '  ' } })).body).toMatchObject({ status: false, code: 'question_required' });
        expect(getProvider).not.toHaveBeenCalled();
        expect(stored()).toEqual([]);
    });

    it('reports a refused model call as an error event with its code', async () => {
        seedTask(OPS);
        getProvider.mockReturnValue({ chat: jest.fn(async () => { throw Object.assign(new Error('Model m-9 has no price.'), { code: 'unpriced_model' }); }) });

        const events = eventsOf(await stream({ body: { question: 'what is the budget' } }));

        expect(events.pop()).toEqual({ event: 'error', statusText: 'Model m-9 has no price.', code: 'unpriced_model' });
        expect(stored()).toEqual([]);
    });

    it('stores nothing when the asker stopped the answer', async () => {
        seedTask(OPS);
        let res;
        getProvider.mockReturnValue({ chat: jest.fn(async () => { res.hangUp(); return { content: 'Budget is 12k [OPS-1].', totalTokens: 42, model: 'm-1' }; }) });

        res = await stream({ body: { question: 'what is the budget' } });

        expect(stored()).toEqual([]);
        expect(eventsOf(res).some((e) => e.event === 'done')).toBe(false);
    });
});

describe('follow-ups', () => {
    it('sends the thread id, rebuilds the context from earlier turns and appends the turn', async () => {
        seedTask(OPS);
        const mine = seedThread();
        const chat = answering('Alice owns it [OPS-1].');

        const done = eventsOf(await stream({ body: { question: 'who owns it', threadId: String(mine._id) } })).pop();

        expect(done.threadId).toBe(String(mine._id));
        const { messages } = chat.mock.calls[0][0];
        expect(messages.slice(0, 2)).toEqual([{ role: 'user', content: 'What is the budget?' }, { role: 'assistant', content: 'It is 12k [OPS-1].' }]);
        expect(messages[2].role).toBe('user');
        expect(messages[2].content).toContain('who owns it');
        expect(stored()[0].turns.map((t) => t.question)).toEqual(['What is the budget?', 'who owns it']);
        expect(stored()[0].turnCount).toBe(2);
    });

    it('re-checks access every turn and never reuses a source the asker can no longer open', async () => {
        seedTask(OPS, { TaskName: 'Budget review secret' });
        seedTask(HR, { TaskName: 'Budget for hiring', TaskKey: 'HR-1' });
        visibleProjects.mockResolvedValue([{ _id: OPS, ProjectName: 'Ops' }, { _id: HR, ProjectName: 'HR' }]);
        answering('Two budgets [OPS-1] [HR-1].');
        const first = eventsOf(await stream({ body: { question: 'budget' } })).pop();
        expect(first.cited).toHaveLength(2);

        visibleProjects.mockResolvedValue([{ _id: HR, ProjectName: 'HR' }]);
        const chat = answering('Only hiring [HR-1].');
        const next = eventsOf(await stream({ body: { question: 'and the budget now', threadId: first.threadId } })).pop();

        const prompt = chat.mock.calls[0][0].messages.slice(-1)[0].content;
        expect(prompt).toContain('Budget for hiring');
        expect(prompt).not.toContain('Budget review secret');
        expect(next.sources.map((s) => s.title)).toEqual(['Budget for hiring']);
        expect(visibleProjects).toHaveBeenLastCalledWith(C, ALICE);
    });

    it('refuses a thread that is not mine, and stores nothing in it', async () => {
        seedTask(OPS);
        const bobs = seedThread({ ownerId: BOB });
        answering('x [OPS-1]');

        const res = await stream({ body: { question: 'budget', threadId: String(bobs._id) } });

        expect(res.statusCode).toBe(404);
        expect(res.body).toMatchObject({ status: false, code: 'thread_not_found' });
        expect(getProvider).not.toHaveBeenCalled();
        expect(stored()[0].turns).toHaveLength(1);
    });

    it('sends at most the last few turns as context and keeps at most the turn limit', async () => {
        seedTask(OPS);
        const many = Array.from({ length: threads.LIMITS.TURNS }, (_, i) => ({ turnId: `t${i}`, question: `q${i}`, answer: `a${i}`, mode: 'ask', model: 'm', cited: [], createdAt: new Date() }));
        const mine = seedThread({ turns: many, turnCount: many.length });
        const chat = answering('Budget [OPS-1].');

        await stream({ body: { question: 'budget', threadId: String(mine._id) } });

        const history = chat.mock.calls[0][0].messages.slice(0, -1);
        expect(history).toHaveLength(threads.LIMITS.CONTEXT_TURNS * 2);
        expect(history[0].content).toBe(`q${threads.LIMITS.TURNS - threads.LIMITS.CONTEXT_TURNS}`);
        const turns = stored()[0].turns;
        expect(turns).toHaveLength(threads.LIMITS.TURNS);
        expect(turns[0].question).toBe('q1');
        expect(turns[turns.length - 1].question).toBe('budget');
    });

    it('keeps at most the thread limit per person, dropping the oldest', async () => {
        seedTask(OPS);
        for (let i = 0; i < threads.LIMITS.THREADS; i += 1) seedThread({ title: `t${i}`, lastTurnAt: new Date(2026, 0, 1 + i) });
        seedThread({ ownerId: BOB, title: 'bobs', lastTurnAt: new Date(2020, 0, 1) });
        answering('Budget [OPS-1].');

        await stream({ body: { question: 'budget' } });

        const mine = stored().filter((t) => t.ownerId === ALICE);
        expect(mine).toHaveLength(threads.LIMITS.THREADS);
        expect(mine.map((t) => t.title)).not.toContain('t0');
        expect(mine.map((t) => t.title)).toContain('budget');
        expect(stored().some((t) => t.title === 'bobs')).toBe(true);
    });
});

describe('erasure by person', () => {
    it('removes every thread the person owns in that workspace and nothing else', async () => {
        seedThread();
        seedThread();
        seedThread({ ownerId: BOB });
        seedThread({ companyId: OTHER_COMPANY });

        expect(await threads.eraseOwner(C, ALICE)).toBe(2);

        expect(stored().map((t) => t.ownerId)).toEqual([BOB]);
        expect(stored(OTHER_COMPANY)).toHaveLength(1);
        await expect(threads.eraseOwner(C, '')).rejects.toThrow(/user/);
    });

    it('is not a mongoose id mix-up: an ObjectId and its text find the same owner', async () => {
        seedThread();
        expect(await threads.eraseOwner(C, new mongoose.Types.ObjectId(ALICE))).toBe(1);
    });
});

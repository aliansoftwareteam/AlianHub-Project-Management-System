const mockDbs = {};
const mockDbFor = (companyId) => {
    const id = String(companyId);
    if (!mockDbs[id]) mockDbs[id] = require('./fixtures/fakeMongo').create();
    return mockDbs[id];
};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(companyId).crud(companyId, q, method) }));
jest.mock('../Config/config', () => {
    const NodeCache = require('node-cache');
    return { myCache: new NodeCache() };
});
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../common-storage/readStoredFile', () => ({ readStoredFile: jest.fn() }));
jest.mock('../Modules/Agents/budget', () => ({ settings: jest.fn(async () => ({ monthlyBudgetUsd: 25 })) }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async () => 3),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { schema } = require('../utils/mongo-handler/schema');
const { getRoleType } = require('../Config/permissionGuard');
const feedback = require('../Modules/AI/feedback');
const quality = require('../Modules/AI/quality');
const askEval = require('../Modules/AI/askEval');
const controls = require('../Modules/Knowledge/controls');
const SET = require('../Modules/AI/evals/askIntent.cases.json');

const C = '6f0000000000000000000c01';
const OTHER = '6f0000000000000000000c02';
const ALICE = '6f0000000000000000000011';
const BOB = '6f0000000000000000000012';
const OWNER = '6f0000000000000000000013';
const TURN = '6f00000000000000000000f1';
const THREAD = '6f00000000000000000000e1';
const PROPOSAL = '6f00000000000000000000d1';
const RUN = '6f00000000000000000000b1';
const QUESTION = 'What is the salary budget for Priya?';
const ANSWER = 'The salary budget is 12k [OPS-1].';
const FEEDBACK = SCHEMA_TYPE.AI_FEEDBACK;
const RUNS = SCHEMA_TYPE.AI_EVAL_RUNS;

const ROLES = { [ALICE]: 3, [BOB]: 3, [OWNER]: 1 };

const db = (companyId = C) => mockDbFor(companyId);
const stored = (companyId = C) => db(companyId).store[FEEDBACK] || [];

const jsonRes = () => {
    const res = { statusCode: 200 };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.send = jest.fn((body) => { res.body = body; return res; });
    res.json = res.send;
    return res;
};

const call = async (handler, { uid = ALICE, companyId = C, params = {}, body = {}, query = {} } = {}) => {
    const res = jsonRes();
    await handler({ headers: { companyid: companyId }, uid, params, body, query }, res);
    return res;
};

const seedThread = (companyId = C, ownerId = ALICE) => db(companyId).seed(SCHEMA_TYPE.ASK_THREADS, {
    _id: THREAD,
    ownerId,
    title: QUESTION,
    turns: [{ turnId: TURN, question: QUESTION, answer: ANSWER, mode: 'ask', model: 'model-a', cited: [{ kind: 'task', sourceId: '6f0000000000000000000071', ref: 'OPS-1' }], createdAt: new Date() }],
    turnCount: 1,
    lastTurnAt: new Date(),
});

const rateTurn = (body = {}, options = {}) => call(feedback.saveFeedback, { ...options, body: { feature: 'ask', kind: 'ask_turn', itemId: TURN, rating: 'down', ...body } });

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    jest.clearAllMocks();
    getRoleType.mockImplementation(async (companyId, uid) => ROLES[String(uid)] || 3);
});

describe('the feedback collections', () => {
    it('are registered, strict, and declare every field a feedback row and an eval run store', () => {
        const { dbCollections } = require('../Config/collections');
        const { checkType, tableType } = jest.requireActual('../utils/mongo-handler/mongoQueries');
        const createSchema = require('../utils/mongo-handler/createSchema');
        expect(FEEDBACK).toBe('ai_feedback');
        expect(RUNS).toBe('ai_eval_runs');
        expect(dbCollections.AI_FEEDBACK).toBe('ai_feedback');
        expect(dbCollections.AI_EVAL_RUNS).toBe('ai_eval_runs');
        expect(checkType(FEEDBACK)).toBe(createSchema.aiFeedbackSchema);
        expect(checkType(RUNS)).toBe(createSchema.aiEvalRunsSchema);
        expect(tableType(FEEDBACK)).toBe('ai_feedback');
        expect(tableType(RUNS)).toBe('ai_eval_runs');
        expect(createSchema.aiFeedbackSchema.options.strict).toBe(true);
        expect(createSchema.aiEvalRunsSchema.options.strict).toBe(true);
        expect(Object.keys(schema.aiFeedback)).toEqual(expect.arrayContaining([
            'userId', 'feature', 'kind', 'itemId', 'threadId', 'runId', 'model', 'rating', 'reasons', 'note', 'via', 'shared', 'answer', 'sources', 'createdAt', 'updatedAt',
        ]));
        expect(Object.keys(schema.aiFeedback)).not.toContain('question');
        expect(Object.keys(schema.aiEvalRuns)).toEqual(expect.arrayContaining(['suite', 'passed', 'total', 'failures', 'ranBy', 'ranAt']));
    });

    it('write nothing the strict schema would drop', async () => {
        seedThread();
        await rateTurn({ reasons: ['wrong'], note: 'cites the wrong task', includeAnswer: true });
        const declared = new Set([...Object.keys(schema.aiFeedback), '_id', '__v']);
        expect(Object.keys(stored()[0]).filter((key) => !declared.has(key))).toEqual([]);
    });
});

describe('rating an Ask answer', () => {
    it('stores the rating, reason, feature, model, turn and person, and never the question or the answer', async () => {
        seedThread();
        const res = await rateTurn({ reasons: ['wrong', 'too_long'], note: 'not the right project', answer: ANSWER, question: QUESTION });

        expect(res.body.status).toBe(true);
        expect(stored()).toHaveLength(1);
        const row = stored()[0];
        expect(row).toMatchObject({
            userId: ALICE, feature: 'ask', kind: 'ask_turn', itemId: TURN, threadId: THREAD, model: 'model-a',
            rating: 'down', reasons: ['wrong', 'too_long'], note: 'not the right project', shared: false,
        });
        expect(row.createdAt).toBeInstanceOf(Date);
        expect(JSON.stringify(row)).not.toContain('12k');
        expect(JSON.stringify(row)).not.toContain('salary');
        expect(row.sources || []).toEqual([]);
        expect(res.body.data).toMatchObject({ rating: 'down', reasons: ['wrong', 'too_long'], shared: false });
    });

    it('keeps the answer and its cited sources only when the person opts in, read from their own thread', async () => {
        seedThread();
        await rateTurn({ reasons: ['missing_sources'], includeAnswer: true, answer: 'a forged answer' });
        expect(stored()[0]).toMatchObject({ shared: true, answer: ANSWER, sources: [{ kind: 'task', id: '6f0000000000000000000071', ref: 'OPS-1' }] });

        await rateTurn({ reasons: ['missing_sources'], includeAnswer: false });
        expect(stored()).toHaveLength(1);
        expect(stored()[0]).toMatchObject({ shared: false, answer: '', sources: [] });
    });

    it('keeps one rating per person and answer, and a thumbs up drops the reasons', async () => {
        seedThread();
        await rateTurn({ reasons: ['wrong'], note: 'nope' });
        await rateTurn({ rating: 'up', reasons: ['wrong'], note: 'nope' });
        expect(stored()).toHaveLength(1);
        expect(stored()[0]).toMatchObject({ rating: 'up', reasons: [], note: '' });
    });

    it('refuses a turn from somebody else\'s thread and stores nothing', async () => {
        seedThread(C, BOB);
        const res = await rateTurn();
        expect(res.statusCode).toBe(404);
        expect(stored()).toEqual([]);
    });

    it('refuses an unknown feature, rating, reason or kind', async () => {
        seedThread();
        expect((await rateTurn({ feature: 'made_up' })).statusCode).toBe(400);
        expect((await rateTurn({ rating: 'meh' })).statusCode).toBe(400);
        expect((await rateTurn({ reasons: ['rude'] })).statusCode).toBe(400);
        expect((await rateTurn({ kind: 'email' })).statusCode).toBe(400);
        expect((await call(feedback.saveFeedback, { uid: '', body: { feature: 'ask', kind: 'ask_turn', itemId: TURN, rating: 'up' } })).statusCode).toBe(401);
        expect(stored()).toEqual([]);
    });
});

describe('rating a preview', () => {
    const ratePreview = (body = {}, options = {}) => call(feedback.saveFeedback, { ...options, body: { feature: 'task_estimate', kind: 'preview', itemId: 'pv-12345678', rating: 'down', ...body } });

    it('reads the model from the person\'s latest call for that feature when the screen does not know it', async () => {
        db().seed(SCHEMA_TYPE.AI_USAGE, { feature: 'task_estimate', model: 'model-old', userId: ALICE, at: new Date(Date.now() - 60000) });
        db().seed(SCHEMA_TYPE.AI_USAGE, { feature: 'task_estimate', model: 'model-new', userId: ALICE, at: new Date() });
        db().seed(SCHEMA_TYPE.AI_USAGE, { feature: 'task_estimate', model: 'model-bob', userId: BOB, at: new Date(Date.now() + 1000) });
        await ratePreview({ reasons: ['wrong'] });
        expect(stored()[0]).toMatchObject({ feature: 'task_estimate', kind: 'preview', model: 'model-new', answer: '', shared: false });
    });

    it('keeps the preview text only when opted in, and clipped', async () => {
        await ratePreview({ answer: 'estimate text' });
        expect(stored()[0].answer).toBe('');
        await ratePreview({ answer: 'x'.repeat(10000), includeAnswer: true });
        expect(stored()[0].shared).toBe(true);
        expect(stored()[0].answer.length).toBe(feedback.LIMITS.ANSWER);
    });
});

describe('rating an agent proposal', () => {
    it('records the run behind the proposal and the model that run used', async () => {
        db().seed(SCHEMA_TYPE.AGENT_PROPOSALS, { _id: PROPOSAL, runId: RUN, status: 'pending', agentName: 'QA' });
        db().seed(SCHEMA_TYPE.AI_USAGE, { feature: 'agent_run', model: 'model-agent', runId: RUN, at: new Date() });
        const res = await call(feedback.saveFeedback, { body: { feature: 'agent_run', kind: 'proposal', itemId: PROPOSAL, rating: 'up' } });
        expect(res.body.status).toBe(true);
        expect(stored()[0]).toMatchObject({ kind: 'proposal', itemId: PROPOSAL, runId: RUN, model: 'model-agent', rating: 'up', via: 'thumbs' });
    });

    it('turns a decline into a thumbs down that carries the decline reason', async () => {
        await feedback.fromDecline(C, BOB, { proposalId: PROPOSAL, runId: RUN, reason: 'wrong_tone' });
        expect(stored()[0]).toMatchObject({ userId: BOB, feature: 'agent_run', kind: 'proposal', itemId: PROPOSAL, rating: 'down', note: 'wrong_tone', via: 'decline' });
    });

    it('refuses a proposal that is not in this workspace', async () => {
        db(OTHER).seed(SCHEMA_TYPE.AGENT_PROPOSALS, { _id: PROPOSAL, runId: RUN, status: 'pending' });
        const res = await call(feedback.saveFeedback, { body: { feature: 'agent_run', kind: 'proposal', itemId: PROPOSAL, rating: 'up' } });
        expect(res.statusCode).toBe(404);
    });
});

describe('who can change a rating', () => {
    it('is only the person who gave it', async () => {
        seedThread();
        await rateTurn({ reasons: ['wrong'] });
        const id = String(stored()[0]._id);

        const bob = await call(feedback.removeFeedback, { uid: BOB, params: { id } });
        expect(bob.statusCode).toBe(404);
        const owner = await call(feedback.removeFeedback, { uid: OWNER, params: { id } });
        expect(owner.statusCode).toBe(404);
        expect(stored()).toHaveLength(1);

        const mineBob = await call(feedback.listMine, { uid: BOB, query: { items: TURN } });
        expect(mineBob.body.data.items).toEqual({});
        const mineAlice = await call(feedback.listMine, { query: { items: TURN } });
        expect(mineAlice.body.data.items[TURN]).toMatchObject({ id, rating: 'down', reasons: ['wrong'] });

        const alice = await call(feedback.removeFeedback, { params: { id } });
        expect(alice.body.status).toBe(true);
        expect(stored()).toEqual([]);
    });
});

describe('company scoping', () => {
    it('keeps a rating in the workspace it was given in', async () => {
        seedThread();
        await rateTurn();
        expect(stored(C)).toHaveLength(1);
        expect(stored(OTHER)).toEqual([]);

        const elsewhere = await call(quality.getQuality, { uid: OWNER, companyId: OTHER });
        expect(elsewhere.body.data.ratings).toMatchObject({ up: 0, down: 0 });
        const mine = await call(feedback.listMine, { companyId: OTHER, query: { items: TURN } });
        expect(mine.body.data.items).toEqual({});
    });
});

describe('erasure by person', () => {
    it('removes the person\'s feedback in that workspace and counts it', async () => {
        const row = (companyId, userId, itemId) => db(companyId).seed(FEEDBACK, { userId, feature: 'ask', kind: 'ask_turn', itemId, rating: 'down', createdAt: new Date() });
        row(C, ALICE, 'turn-000001');
        row(C, ALICE, 'turn-000002');
        row(C, BOB, 'turn-000003');
        row(OTHER, ALICE, 'turn-000004');

        const result = await controls.erasePerson(C, ALICE);

        expect(result.removed.ai_feedback).toBe(2);
        expect(stored(C).map((r) => r.userId)).toEqual([BOB]);
        expect(stored(OTHER).map((r) => r.userId)).toEqual([ALICE]);
    });

    it('finds a person who left nothing but feedback', async () => {
        expect(await controls.personExists(C, ALICE)).toBe(false);
        db().seed(FEEDBACK, { userId: ALICE, feature: 'ask', kind: 'ask_turn', itemId: 'turn-000001', rating: 'up', createdAt: new Date() });
        expect(await controls.personExists(C, ALICE)).toBe(true);
    });
});

describe('the AI quality page', () => {
    const seedRatings = () => {
        const row = (over) => db().seed(FEEDBACK, { feature: 'ask', kind: 'ask_turn', model: 'model-a', reasons: [], note: '', shared: false, answer: '', sources: [], via: 'thumbs', createdAt: new Date(), ...over });
        row({ userId: ALICE, itemId: 'turn-aaaaaa', rating: 'down', reasons: ['wrong'], shared: true, answer: 'shared answer text', sources: [{ kind: 'task', id: 't1', ref: 'OPS-1' }] });
        row({ userId: BOB, itemId: 'turn-bbbbbb', rating: 'down', reasons: ['too_long'], answer: '' });
        row({ userId: BOB, itemId: 'turn-cccccc', rating: 'up', model: 'model-b' });
        row({ userId: ALICE, itemId: 'pv-dddddd', feature: 'task_estimate', kind: 'preview', rating: 'up', model: 'model-b' });
        db().seed(SCHEMA_TYPE.AI_USAGE, { feature: 'ask', model: 'model-a', costUsd: 0.25, totalTokens: 100, billedToWorkspace: true, at: new Date() });
        db().seed(SCHEMA_TYPE.AI_USAGE, { feature: 'task_estimate', model: 'model-b', costUsd: 0.05, totalTokens: 10, billedToWorkspace: true, at: new Date() });
    };

    it('is refused to a member', async () => {
        const res = await call(quality.getQuality, { uid: ALICE });
        expect(res.statusCode).toBe(403);
        const run = await call(quality.runHeldOut, { uid: ALICE });
        expect(run.statusCode).toBe(403);
        expect(db().store[RUNS] || []).toEqual([]);
    });

    it('shows ratings by feature and model, the most disliked with only opted-in answers, and cost per feature', async () => {
        seedRatings();
        const res = await call(quality.getQuality, { uid: OWNER, query: { days: '30' } });
        expect(res.body.status).toBe(true);
        const data = res.body.data;
        expect(data.ratings).toMatchObject({ up: 2, down: 2 });
        expect(data.ratings.byFeature).toEqual(expect.arrayContaining([
            { feature: 'ask', up: 1, down: 2 },
            { feature: 'task_estimate', up: 1, down: 0 },
        ]));
        expect(data.ratings.byModel).toEqual(expect.arrayContaining([
            { model: 'model-a', up: 0, down: 2 },
            { model: 'model-b', up: 2, down: 0 },
        ]));
        expect(data.ratings.series.length).toBe(30);
        expect(data.disliked.map((d) => d.itemId).sort()).toEqual(['turn-aaaaaa', 'turn-bbbbbb']);
        const shared = data.disliked.find((d) => d.itemId === 'turn-aaaaaa');
        expect(shared.shared).toEqual([expect.objectContaining({ answer: 'shared answer text', sources: [{ kind: 'task', id: 't1', ref: 'OPS-1' }] })]);
        expect(data.disliked.find((d) => d.itemId === 'turn-bbbbbb').shared).toEqual([]);
        expect(JSON.stringify(data)).not.toContain(ALICE);
        expect(JSON.stringify(data)).not.toContain(BOB);
        expect(data.cost.features.map((f) => f.feature)).toEqual(['ask', 'task_estimate']);
        expect(data.cost.usedUsd).toBeCloseTo(0.3);
        expect(data.heldOut).toBeNull();
    });

    it('runs the held-out question set on demand without a model and keeps the result', async () => {
        const res = await call(quality.runHeldOut, { uid: OWNER });
        expect(res.body.status).toBe(true);
        expect(res.body.data).toMatchObject({ suite: 'ask_intent', total: SET.cases.length, passed: SET.cases.length, failures: [] });
        expect(db().store[RUNS]).toHaveLength(1);
        expect(db().store[RUNS][0]).toMatchObject({ suite: 'ask_intent', total: SET.cases.length, ranBy: OWNER });

        const page = await call(quality.getQuality, { uid: OWNER });
        expect(page.body.data.heldOut).toMatchObject({ passed: SET.cases.length, total: SET.cases.length });
    });
});

describe('the held-out runner', () => {
    it('reports a case whose tasks do not match, with what it got', () => {
        const out = askEval.runHeldOut({ cases: [{ question: 'What is due today?', expect: ['SMOKE-6'] }, { question: 'What is due tomorrow in Local Smoke?', expect: ['SMOKE-6'] }] });
        expect(out).toMatchObject({ total: 2, passed: 1 });
        expect(out.failures).toEqual([{ question: 'What is due today?', expected: ['SMOKE-6'], got: ['SMOKE-5'] }]);
    });

    it('passes the whole shipped set against the live intent reader', () => {
        const out = askEval.runHeldOut();
        expect(out.failures).toEqual([]);
        expect(out.passed).toBe(SET.cases.length);
    });
});

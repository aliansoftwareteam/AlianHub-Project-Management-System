/* A goal's written summary: made only when someone presses the button, from the goal's own name, dates and numbers,
 * kept on the goal, and booked to the workspace's AI budget. The model call goes through the real meter and
 * reservation, with only the vendor mocked. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async () => 1), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/openaiProvider', () => ({ name: 'openai', model: 'gpt-4.1', isConfigured: true, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/anthropicProvider', () => ({ name: 'anthropic', model: null, isConfigured: false, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/deepseekProvider', () => ({ name: 'deepseek', model: null, isConfigured: false, chat: jest.fn() }));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const adapter = require('../Modules/AICore/llmProvider/openaiProvider');
const goals = require('../Modules/Goals/controller');
const summary = require('../Modules/Goals/goalSummary');
const { schema } = require('../utils/mongo-handler/schema');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000003';
const NAMED = '6f0000000000000000000004';
const OUTSIDER = '6f0000000000000000000005';
const GUEST = '6f0000000000000000000006';
const ADMIN = '6f0000000000000000000002';
const ROLES = { [ADMIN]: 2, [OWNER]: 3, [NAMED]: 3, [OUTSIDER]: 3, [GUEST]: 0 };
const ROUTER = process.env.AI_MODEL_ROUTER;

const TASK_NAME = 'Secret list of the Payroll project';
const TARGETS = [
    { id: 't1', name: 'New customers', kind: 'number', start: 0, target: 10, current: 3, unit: 'customers', progressPct: 30, weight: 1 },
    { id: 't2', name: 'Launched', kind: 'boolean', done: true, progressPct: 100, weight: 1 },
    { id: 't3', name: 'Ship the work', kind: 'tasks', progressPct: 50, weight: 1, sources: { sprintIds: ['6f0000000000000000000e01'], taskIds: [] }, counted: { done: 2, total: 4 } },
];

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
};
const call = async (handler, uid, id) => {
    const res = response();
    await handler({ headers: { companyid: C }, aud: C, uid, body: {}, query: {}, params: { id } }, res);
    return res;
};
const ask = (uid, id) => call(goals.summariseGoal, uid, id);
const read = (uid, id) => call(goals.getGoal, uid, id);

const ledger = () => mockDb.store[SCHEMA_TYPE.AI_USAGE] || [];
const row = (id) => (mockDb.store[SCHEMA_TYPE.GOALS] || []).find((goal) => String(goal._id) === id);
const reply = (content) => ({ content, inputTokens: 1000, outputTokens: 500, totalTokens: 1500, model: adapter.model });
const seedGoal = (over = {}) => {
    const goal = mockDb.seed(SCHEMA_TYPE.GOALS, {
        _id: new mongoose.Types.ObjectId(), name: 'Grow revenue', description: 'Private notes', ownerUserId: OWNER, visibility: 'workspace', sharedWith: [],
        periodStart: '2026-10-01', periodEnd: '2026-12-31', progressPct: 60, targets: TARGETS, revision: 0, deletedStatusKey: 0, ...over,
    });
    return String(goal._id);
};

beforeAll(() => {
    jest.useFakeTimers();
    process.env.AI_MODEL_ROUTER = 'on';
});
afterAll(() => {
    jest.useRealTimers();
    if (ROUTER === undefined) delete process.env.AI_MODEL_ROUTER;
    else process.env.AI_MODEL_ROUTER = ROUTER;
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; });
    jest.clearAllMocks();
    jest.clearAllTimers();
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_PRICING;
    adapter.chat.mockImplementation(async () => reply('{"summary":"Growth is at 60 percent."}'));
    mockDb.seed(dbCollections.COMPANIES, { _id: C, agentMonthlyBudgetUsd: 1 });
    Object.entries(ROLES).forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
});

describe('who may ask for a summary', () => {
    it('the owner may, and the summary is kept on the goal with the time and a hash of its inputs', async () => {
        const id = seedGoal();
        const res = await ask(OWNER, id);
        expect(res.statusCode).toBe(200);
        expect(res.body.data.summary).toEqual({ text: 'Growth is at 60 percent.', madeAt: expect.any(String), stale: false });
        expect(row(id).aiSummary).toMatchObject({ text: 'Growth is at 60 percent.', basis: expect.stringMatching(/^[a-f0-9]{64}$/), madeAt: expect.any(Date) });
        expect(adapter.chat).toHaveBeenCalledTimes(1);
    });

    it('a reader named on a goal shared with people may read the summary but not make one', async () => {
        const id = seedGoal({ visibility: 'people', sharedWith: [NAMED] });
        await ask(OWNER, id);
        adapter.chat.mockClear();

        const refused = await ask(NAMED, id);
        expect(refused.statusCode).toBe(403);
        expect(adapter.chat).not.toHaveBeenCalled();
        expect((await read(NAMED, id)).body.data.summary).toMatchObject({ text: 'Growth is at 60 percent.', stale: false });
    });

    it('a member who cannot read a private goal is answered as if it did not exist, and no model is called', async () => {
        const id = seedGoal({ visibility: 'private' });
        await ask(OWNER, id);
        adapter.chat.mockClear();

        const res = await ask(OUTSIDER, id);
        const missing = await ask(OUTSIDER, '6f00000000000000000000ff');
        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual(missing.body);
        expect((await read(OUTSIDER, id)).statusCode).toBe(404);
        expect(adapter.chat).not.toHaveBeenCalled();
    });

    it('a guest not named on a workspace goal is answered as if it did not exist', async () => {
        const id = seedGoal({ visibility: 'workspace' });
        const res = await ask(GUEST, id);
        expect(res.statusCode).toBe(404);
        expect(adapter.chat).not.toHaveBeenCalled();
    });

    it('a guest named on a workspace goal reads the summary but may not make one', async () => {
        const id = seedGoal({ visibility: 'workspace', sharedWith: [GUEST] });
        await ask(OWNER, id);
        expect((await ask(GUEST, id)).statusCode).toBe(403);
        expect((await read(GUEST, id)).body.data.summary.text).toBe('Growth is at 60 percent.');
    });

    it('an admin may make one for a workspace goal, and the member who owns a private goal alone may for theirs', async () => {
        expect((await ask(ADMIN, seedGoal({ visibility: 'workspace' }))).statusCode).toBe(200);
        expect((await ask(ADMIN, seedGoal({ visibility: 'private' }))).statusCode).toBe(404);
    });

    it('an archived goal is not summarised', async () => {
        const res = await ask(OWNER, seedGoal({ deletedStatusKey: 2 }));
        expect(res.statusCode).toBe(409);
        expect(adapter.chat).not.toHaveBeenCalled();
    });
});

describe('no model call on read', () => {
    it('opening, listing and reading a goal again never reach the model', async () => {
        const id = seedGoal();
        await call(goals.listGoals, OWNER);
        await read(OWNER, id);
        await read(ADMIN, id);
        expect(adapter.chat).not.toHaveBeenCalled();
        expect(ledger()).toHaveLength(0);
        expect((await read(OWNER, id)).body.data.summary).toBeUndefined();
    });

    it('reading a goal that has a summary leaves the ledger as it was', async () => {
        const id = seedGoal();
        await ask(OWNER, id);
        const booked = ledger().length;
        await read(OWNER, id);
        await call(goals.listGoals, ADMIN);
        expect(adapter.chat).toHaveBeenCalledTimes(1);
        expect(ledger()).toHaveLength(booked);
    });
});

describe('the stale marker', () => {
    it('shows once a target number or a date changes, and clears when it is made again', async () => {
        const id = seedGoal();
        await ask(OWNER, id);
        expect((await read(OWNER, id)).body.data.summary.stale).toBe(false);

        row(id).targets[0].current = 7;
        const behind = (await read(OWNER, id)).body.data.summary;
        expect(behind).toMatchObject({ text: 'Growth is at 60 percent.', stale: true });

        row(id).periodEnd = '2027-01-31';
        expect((await read(OWNER, id)).body.data.summary.stale).toBe(true);

        await ask(OWNER, id);
        expect((await read(OWNER, id)).body.data.summary.stale).toBe(false);
        expect(adapter.chat).toHaveBeenCalledTimes(2);
    });

    it('is not raised by a change to the description or the people it is shared with', async () => {
        const id = seedGoal();
        await ask(OWNER, id);
        row(id).description = 'Rewritten';
        row(id).sharedWith = [NAMED];
        expect((await read(OWNER, id)).body.data.summary.stale).toBe(false);
    });
});

describe('the budget', () => {
    it('is booked to the workspace as its own feature, for the person who asked', async () => {
        await ask(OWNER, seedGoal());
        expect(ledger().map((entry) => entry.feature)).toEqual(['goal_summary']);
        expect(ledger()[0]).toMatchObject({ companyId: C, userId: OWNER, billedToWorkspace: true });
    });

    it('refuses with ai_budget_exhausted before the model is called, and keeps nothing', async () => {
        mockDb.seed(SCHEMA_TYPE.AI_USAGE, { companyId: C, feature: 'ask', model: 'gpt-4.1', costUsd: 1.5, totalTokens: 1, billedToWorkspace: true, at: new Date() });
        const id = seedGoal();
        const res = await ask(OWNER, id);
        expect(res.statusCode).toBe(402);
        expect(res.body).toMatchObject({ status: false, code: 'ai_budget_exhausted', message: expect.stringMatching(/^ai_budget_exhausted: /) });
        expect(adapter.chat).not.toHaveBeenCalled();
        expect(row(id).aiSummary).toBeUndefined();
        expect(ledger()).toHaveLength(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('answers that AI is unavailable when no provider is configured, and calls nothing', async () => {
        adapter.isConfigured = false;
        try {
            const res = await ask(OWNER, seedGoal());
            expect(res.statusCode).toBe(409);
            expect(res.body).toMatchObject({ code: 'ai_unavailable', aiState: 'unconfigured' });
            expect(adapter.chat).not.toHaveBeenCalled();
        } finally {
            adapter.isConfigured = true;
        }
    });
});

describe('what the model is told', () => {
    it('holds the goal name, dates, targets and their numbers, and no list, task or sprint name or id', async () => {
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: new mongoose.Types.ObjectId('6f0000000000000000000e01'), name: TASK_NAME });
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: new mongoose.Types.ObjectId('6f0000000000000000000f01'), TaskName: TASK_NAME });
        await ask(OWNER, seedGoal());

        const { systemPrompt, messages } = adapter.chat.mock.calls[0][0];
        const sent = `${systemPrompt}\n${messages.map((message) => message.content).join('\n')}`;
        expect(sent).toContain('Grow revenue');
        expect(sent).toContain('2026-10-01');
        expect(sent).toContain('2026-12-31');
        expect(sent).toContain('New customers');
        expect(sent).toContain('"current":3');
        expect(sent).toContain('"total":4');
        expect(sent).not.toContain(TASK_NAME);
        expect(sent).not.toContain('Payroll');
        expect(sent).not.toContain('6f0000000000000000000e01');
        expect(sent).not.toContain('sprintIds');
        expect(sent).not.toContain('Private notes');
    });

    it('is the same for every goal reader: the inputs are a function of the stored goal alone', () => {
        const goal = { name: 'G', periodStart: '', periodEnd: '', progressPct: 0, targets: TARGETS };
        expect(summary.basisOf(goal)).toBe(summary.basisOf({ ...goal, description: 'x', sharedWith: ['a'], updatedAt: new Date() }));
        expect(summary.basisOf(goal)).not.toBe(summary.basisOf({ ...goal, name: 'H' }));
    });
});

describe('the stored fields', () => {
    it('are declared in the goals schema, so a strict schema does not drop them', () => {
        expect(Object.keys(schema.goals.aiSummary).sort()).toEqual(['basis', 'madeAt', 'text']);
        const { goalsSchema } = require('../utils/mongo-handler/createSchema');
        expect(['aiSummary.text', 'aiSummary.basis', 'aiSummary.madeAt'].filter((path) => !goalsSchema.path(path))).toEqual([]);
    });

    it('is written by a single update of that field, which names no revision', async () => {
        const id = seedGoal();
        mockDb.calls.length = 0;
        await ask(OWNER, id);
        const writes = mockDb.calls.filter((entry) => entry.type === SCHEMA_TYPE.GOALS && entry.method === 'updateOne');
        expect(writes).toHaveLength(1);
        expect(Object.keys(writes[0].data[1].$set)).toEqual(['aiSummary']);
    });
});

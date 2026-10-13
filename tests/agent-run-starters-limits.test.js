/* A run is held to what the request that started it was held to: an agent's rule for chat and, for a token or a call
   held to some projects, that list. It is kept on the run where the run starts and entered where its skill executes,
   so the run is answered the same whether it executes after the reply, from the queue, or in the middle of someone
   else's request. */
process.env.STORAGE_TYPE = 'server';
process.env.AUTOMATION_QUEUE_DRIVER = 'inline';
jest.setTimeout(30000);
const mockDb = require('./fixtures/fakeMongo').create();
const mockQueue = { handlers: new Map(), jobs: [] };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleStoredFileCopy: jest.fn(), handleTaskAttachmentsDuplicateFunctionality: jest.fn() }));
jest.mock('../Modules/Comments/helpers/commentNotifications', () => ({ resolveMentionIds: jest.fn(async () => []), deliverMentions: jest.fn(async () => []) }));
jest.mock('../Modules/AICore/aiSwitch', () => ({ AI_OFF: 'ai_off', allowed: jest.fn(async () => true), assertAllowed: jest.fn(async () => {}), isAiOff: () => false }));
jest.mock('../Modules/AICore/usage', () => ({ checkConfiguredModelPriced: () => ({ ok: true, reason: '' }), summarize: jest.fn(() => ({ costUsd: 0, totalTokens: 0, model: 'm' })) }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ publishCommentChanged: jest.fn(), publishGuideSaved: jest.fn() }));
/* A queue that keeps each job until the test picks it up, where the test chooses. */
jest.mock('../Modules/Automations/engine/queue', () => ({
    INLINE: 'inline',
    createInlineDriver: () => ({
        name: 'inline',
        start: async () => {},
        stop: async () => {},
        define: (name, handler) => mockQueue.handlers.set(name, handler),
        every: async () => {},
        enqueue: async (name, data) => { mockQueue.jobs.push({ name, data }); },
    }),
}));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { schema } = require('../utils/mongo-handler/schema');
const world = require('./fixtures/accessWorld');
const requestContext = require('../Config/requestContext');
const { runNarrowed, narrowingFor } = require('../Config/tokenNarrowing');
const { runForAgentOf, agentOf } = require('../Config/agentRequest');
const actingAgent = require('../Modules/Agents/actingAgent');
const writerLimits = require('../event/writerLimits');
const runs = require('../Modules/Agents/runs');
const actions = require('../Modules/Agents/actions');
const triggers = require('../Modules/Agents/triggers');
const agentsCtrl = require('../Modules/Agents/controller');
const { agentPerimeter } = require('../Modules/Agents/guard');
const tools = require('../Modules/Automations/engine/tools');
const engine = require('../Modules/Automations/engine');
const agentRunner = require('../Modules/Workflows/agentRun');

const { CID, OWNER, P_OPEN, P_PRIVATE, T_OPEN, settle } = world;
const { seed, rows } = world.create(mockDb);

const DM_SPACE = '6f0000000000000000000ca2';
const DM = '6f0000000000000000000cd1';
const REVIEWER = '6f0000000000000000000a11';
const NOT_VISIBLE = /^not_visible/;
const THREAD_REFUSED = /comment thread is not one the person this runs for can open/;

const AgentRunAsStored = mongoose.model('AgentRunAsStored', new mongoose.Schema(schema.agentRuns));
const asStored = (row) => new AgentRunAsStored(row).toObject();

const session = (uid) => ({ uid });
const agentToken = (uid) => ({ uid, apiToken: { _id: '6f0000000000000000000101', kind: 'agent', name: 'Claude', userId: uid, scopes: ['read', 'write'] } });

/* What stands in front of every route, then the route's own handler. */
const start = (caller) => new Promise((resolve) => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const req = { ...caller, method: 'POST', originalUrl: '/api/v2/agents/runs', url: '/api/v2/agents/runs', query: {}, params: {}, headers: { companyid: CID }, ip: '1.1.1.1', body: { agentId: REVIEWER, taskId: T_OPEN, trigger: 'manual' } };
    agentPerimeter(req, res, () => agentsCtrl.startRun(req, res));
}).then(async (answer) => { await settle(); return answer; });

const runRows = () => rows(SCHEMA_TYPE.AGENT_RUNS);
const whereItRuns = (uid) => ({ agent: agentOf(uid), narrowedTo: narrowingFor(uid), mark: actingAgent.current(), heldCall: writerLimits.ofThisRequest() });
const UNDER_NOTHING = { agent: null, narrowedTo: null, mark: null, heldCall: null };

/* In place of the model's graph: a skill whose steps name the direct message, answered as the run's actions answer them. */
const stepped = [];
const stepsNamingTheDirectMessage = async (companyId, run, agent, task, deps) => {
    stepped.push({
        comment: await actions.personRefusal(companyId, deps.actor, 'task.comment', { taskId: DM, body: 'A note' }),
        chatPost: await actions.personRefusal(companyId, deps.actor, 'chat.post', { taskId: DM, body: 'A note' }),
        written: await tools.addComment(companyId, DM, 'A note', { actingUserId: deps.actor.userId }).then(() => 'written', (error) => error.message),
        under: whereItRuns(run.startedBy),
    });
    return { status: 'done' };
};
const REFUSED = { comment: expect.stringMatching(NOT_VISIBLE), chatPost: expect.stringMatching(NOT_VISIBLE), written: expect.stringMatching(THREAD_REFUSED) };
const ALLOWED = { comment: '', chatPost: '', written: 'written' };

const pickUp = async () => {
    for (const job of mockQueue.jobs.splice(0)) {
        // eslint-disable-next-line no-await-in-loop
        await mockQueue.handlers.get(job.name)({ attrs: { data: job.data } });
    }
    await settle();
};

/* Someone else's work in flight: a request made with another token of the same person, held to another project and given chat. */
const insideAnotherTokensRequest = (work) => requestContext.run({ id: 'req-2', uid: OWNER }, () => runNarrowed({ userId: OWNER, projectIds: [P_PRIVATE] },
    () => runForAgentOf(OWNER, { chat: true }, () => actingAgent.runAs({ userId: OWNER, agentId: 'agent-9', agentName: 'Other', depth: 0 }, work))));
const insideThePersonsSession = (work) => requestContext.run({ id: 'req-3', uid: OWNER }, work);

beforeAll(async () => {
    require('../Modules/AICore/persistence').useInMemory();
    await engine.start();
});

afterAll(() => engine.stop());

beforeEach(() => {
    jest.clearAllMocks();
    seed();
    stepped.length = 0;
    mockQueue.jobs.length = 0;
    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: DM_SPACE, ProjectName: 'Direct messages', default: true });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: DM, TaskName: 'Olive and Ian', CompanyId: CID, ProjectID: DM_SPACE, mainChat: true, AssigneeUserId: [OWNER], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: REVIEWER, name: 'Reviewer', autonomy: 1, allowedActions: [], account: 'workspace', spendCapUsd: 10, paused: false, deletedStatusKey: 0, projectIds: [], skills: [{ key: 'qa-review', name: 'QA', enabled: true }] });
    jest.spyOn(runs, 'executeSkill').mockImplementation(stepsNamingTheDirectMessage);
});

afterEach(() => {
    runs.executeSkill.mockRestore();
    delete process.env.WORKFLOW_ENGINE;
});

describe('what a run is started under', () => {
    it('is kept on the run, in fields the stored row declares', async () => {
        await start(agentToken(OWNER));

        expect(runRows()).toHaveLength(1);
        expect(asStored(runRows()[0]).startedUnder).toEqual({ agent: true, chat: false, projectIds: [] });
    });

    it('says a person started it where a person did', async () => {
        await start(session(OWNER));

        expect(asStored(runRows()[0]).startedUnder).toEqual({ agent: false, chat: false, projectIds: [] });
    });

    it('is read from the request the server runs, never from what the request sends', async () => {
        const res = { status: () => res, send: () => res, json: () => res };
        const body = { agentId: REVIEWER, taskId: T_OPEN, trigger: 'manual', startedUnder: { agent: true, chat: true, projectIds: [P_PRIVATE] } };
        await agentsCtrl.startRun({ ...session(OWNER), method: 'POST', originalUrl: '/api/v2/agents/runs', query: {}, params: {}, headers: { companyid: CID }, ip: '1.1.1.1', body }, res);
        await settle();

        expect(runRows()[0].startedUnder).toEqual({ agent: false, chat: false, projectIds: [] });
    });

    it.each([
        ['a token held to one project', (work) => runNarrowed({ userId: OWNER, projectIds: [P_OPEN] }, () => runForAgentOf(OWNER, { chat: false }, work))],
        ['a call held to one project', (work) => writerLimits.duringCall({ userId: OWNER, projectIds: [P_OPEN], chat: false }, work)],
    ])('keeps the project list of %s, and the run executes inside it', async (label, heldTo) => {
        process.env.WORKFLOW_ENGINE = 'on';
        const [agent, task] = [await runs.getAgent(CID, REVIEWER), await tools.getTask(CID, T_OPEN)];
        await heldTo(() => triggers.launch(CID, { agent, task, trigger: triggers.TRIGGER.MENTION, startedBy: OWNER, note: 'Please look', depth: 0 }));
        await settle();
        await pickUp();

        expect(asStored(runRows()[0]).startedUnder).toEqual({ agent: true, chat: false, projectIds: [P_OPEN] });
        expect(stepped.map(({ under }) => under)).toEqual([{ agent: { uid: OWNER, chat: false }, narrowedTo: [P_OPEN], mark: null, heldCall: { userId: OWNER, projectIds: [P_OPEN], chat: false } }]);
    });
});

describe('a run an agent\'s token starts, whose step names a direct message', () => {
    const PICKED_UP = [
        ['outside any request', (work) => work()],
        ['inside the person\'s own session', insideThePersonsSession],
        ['inside another token\'s request', insideAnotherTokensRequest],
    ];

    it.each(PICKED_UP)('is refused the step when queued and picked up %s', async (label, where) => {
        process.env.WORKFLOW_ENGINE = 'on';
        await start(agentToken(OWNER));
        expect(stepped).toEqual([]);

        await where(pickUp);

        expect(stepped).toEqual([{ ...REFUSED, under: { ...UNDER_NOTHING, agent: { uid: OWNER, chat: false } } }]);
    });

    it('is refused the step when it executes after the reply, with workflows off', async () => {
        await start(agentToken(OWNER));

        expect(mockQueue.jobs).toEqual([]);
        expect(stepped).toEqual([{ ...REFUSED, under: { ...UNDER_NOTHING, agent: { uid: OWNER, chat: false } } }]);
    });

    it.each(PICKED_UP)('is refused the step where its skill executes %s', async (label, where) => {
        const run = mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: REVIEWER, agentName: 'Reviewer', taskId: T_OPEN, projectId: P_OPEN, status: 'running', viaAccount: 'workspace', startedBy: OWNER, startedUnder: { agent: true, chat: false, projectIds: [] } });

        await where(() => agentRunner.executeAgentRun(CID, run));

        expect(stepped).toEqual([{ ...REFUSED, under: { ...UNDER_NOTHING, agent: { uid: OWNER, chat: false } } }]);
    });
});

describe('the same run started by the person', () => {
    it('is allowed the step when queued and picked up', async () => {
        process.env.WORKFLOW_ENGINE = 'on';
        await start(session(OWNER));
        await pickUp();

        expect(stepped).toEqual([{ ...ALLOWED, under: UNDER_NOTHING }]);
    });

    it('is allowed the step when it executes after the reply, with workflows off', async () => {
        await start(session(OWNER));

        expect(stepped).toEqual([{ ...ALLOWED, under: UNDER_NOTHING }]);
    });

    it('is allowed the step where its skill executes in the middle of an agent\'s request', async () => {
        const run = mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: REVIEWER, agentName: 'Reviewer', taskId: T_OPEN, projectId: P_OPEN, status: 'running', viaAccount: 'workspace', startedBy: OWNER, startedUnder: { agent: false, chat: false, projectIds: [] } });

        await insideAnotherTokensRequest(() => agentRunner.executeAgentRun(CID, run));

        expect(stepped).toEqual([{ ...ALLOWED, under: UNDER_NOTHING }]);
    });

    it('is allowed it too on a run kept before runs said what they were started under', async () => {
        const run = mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: REVIEWER, agentName: 'Reviewer', taskId: T_OPEN, projectId: P_OPEN, status: 'running', viaAccount: 'workspace', startedBy: OWNER });

        await agentRunner.executeAgentRun(CID, run);

        expect(stepped).toEqual([{ ...ALLOWED, under: UNDER_NOTHING }]);
    });
});

describe('a job the queue repeats', () => {
    it('runs under none of the request it is picked up in', async () => {
        const seen = [];
        await engine.defineRecurring('probe.every', 60000, async () => { seen.push({ ...whereItRuns(OWNER), request: requestContext.get() }); });

        await insideAnotherTokensRequest(() => mockQueue.handlers.get('probe.every')({ attrs: { data: {} } }));

        expect(seen).toEqual([{ ...UNDER_NOTHING, request: null }]);
    });
});

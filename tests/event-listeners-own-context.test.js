/* What hears of a change acts for its own people: a rule for its maker, a screen for the person looking at it. It is
   told outside the request that made the change, and reads what it needs of that change from the event: who made
   it, how deep in a chain, its trace and its workspace. */
process.env.AUTOMATION_QUEUE_DRIVER = 'inline';
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/settings/securityPermissions/controller', () => ({ fetchRules: jest.fn(async () => []) }));
jest.mock('../Modules/Automations/engine/registry', () => ({ ...jest.requireActual('../Modules/Automations/engine/registry'), getAction: jest.fn() }));

const mockOpens = async (companyId, uid, projectId) => (await require('../Config/projectAccess').canReadProject(companyId, uid, projectId)).allowed;
jest.mock('../Modules/Pages/helpers/pageAccess', () => ({ canUsePage: (companyId, page, uid) => mockOpens(companyId, uid, page.ProjectID) }));
jest.mock('../Modules/AgentSessions/access', () => ({
    taskOf: async (companyId, taskId) => ({ _id: taskId, ProjectID: '6f00000000000000000e0a02' }),
    canOpenTask: (companyId, uid, task) => mockOpens(companyId, uid, task.ProjectID),
}));

const { ObjectId } = require('mongodb');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const logger = require('../Config/loggerConfig');
const telemetry = require('../Config/telemetry');
const requestContext = require('../Config/requestContext');
const { runNarrowed, narrowingFor } = require('../Config/tokenNarrowing');
const { runForAgentOf, agentOf } = require('../Config/agentRequest');
const { canReadProject } = require('../Config/projectAccess');
const actingAgent = require('../Modules/Agents/actingAgent');
const providerContext = require('../Modules/AICore/providerContext');
const socketEmitter = require('../event/socketEventEmitter');
const domainEventBus = require('../event/domainEventBus');
const registry = require('../Modules/Automations/engine/registry');
const matcher = require('../Modules/Automations/engine/matcher');
const engine = require('../Modules/Automations/engine');
const formEvent = require('../Modules/Automations/engine/formEvent');
const runs = require('../Modules/Agents/runs');
const { upsertRoom, removeRoom } = require('../socket/helper');
const { pageCommentRoomOf } = require('../socket/roomAccess');
const { relayPageComment } = require('../socket/controller/commentSocket');
const sessionRelay = require('../socket/controller/agentSessionSocket');

const C = '6f00000000000000000e0c01';
const PERSON = '6f00000000000000000e0011';
const IN_REACH = '6f00000000000000000e0a01';
const ELSEWHERE = '6f00000000000000000e0a02';
const LIST = '6f00000000000000000e0b01';
const TASK = '6f00000000000000000e0701';
const PAGE = '6f00000000000000000e0901';
const WAIT_MS = 20;

const REQUEST = { id: 'req-1', uid: PERSON };
const mark = (depth = 0) => ({ userId: PERSON, agentId: 'agent-1', agentName: 'Helper', depth });

/* What a request made with an agent's token, narrowed to one project, runs its handler inside. */
const insideARequest = (work, depth = 0) => requestContext.run({ ...REQUEST }, () => runNarrowed({ userId: PERSON, projectIds: [IN_REACH] },
    () => runForAgentOf(PERSON, { chat: false }, () => actingAgent.runAs(mark(depth), work))));

const whereItRuns = () => ({
    narrowedTo: narrowingFor(PERSON), agent: agentOf(PERSON), mark: actingAgent.current(), request: requestContext.get(), workspace: providerContext.companyIdOf(),
});
const outsideTheRequest = (traceId) => ({ narrowedTo: null, agent: null, mark: null, request: { traceId }, workspace: C });

const realSetTimeout = global.setTimeout;
const settle = (ms = WAIT_MS * 6) => new Promise((resolve) => { realSetTimeout(resolve, ms); });

const task = (over = {}) => ({ _id: TASK, CompanyId: C, TaskName: 'Ship', TaskKey: 'T-1', Task_Priority: 'LOW', ProjectID: IN_REACH, sprintId: LIST, deletedStatusKey: 0, AssigneeUserId: [PERSON], ...over });
const changePriority = (priority) => socketEmitter.emit('update', { type: 'update', module: 'task', companyId: C, data: task({ Task_Priority: priority }), updatedFields: { Task_Priority: priority } });

const seedRule = (over = {}) => mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, {
    _id: new ObjectId(), name: 'Probe', enabled: true, deletedStatusKey: 0, trigger: 'task.priority_changed', scope: { allProjects: true },
    reactToAutomation: true, createdBy: PERSON, steps: [{ id: 's1', type: 'action', action: 'probe', config: {} }], ...over,
});

let heard;
const hear = (envelope) => heard.push({ envelope, ...whereItRuns() });
let steps;

beforeAll(async () => {
    jest.spyOn(global, 'setTimeout').mockImplementation((run, ms, ...args) => realSetTimeout(run, Math.min(Number(ms) || 0, WAIT_MS), ...args));
    domainEventBus.start();
    await engine.start();
    registry.getAction.mockImplementation((key) => (key === 'probe' ? {
        run: async ({ companyId, context }) => {
            steps.push({ actor: context.actor, depth: context.depth, makerOpensElsewhere: (await canReadProject(companyId, PERSON, ELSEWHERE)).allowed, ...whereItRuns() });
            return { ok: true };
        },
    } : null));
});

afterAll(async () => {
    await engine.stop();
    global.setTimeout.mockRestore();
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; });
    myCache.flushAll();
    matcher.invalidateAll();
    sessionRelay.resetDecisions();
    logger.error.mockClear();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: PERSON, roleType: 3, status: 2, isDelete: false });
    [IN_REACH, ELSEWHERE].forEach((id) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: new ObjectId(id), ProjectName: id, isPrivateSpace: true, AssigneeUserId: [PERSON] }));
    heard = [];
    steps = [];
    domainEventBus.bus.on('domain.event', hear);
});

afterEach(async () => {
    await settle();
    domainEventBus.bus.off('domain.event', hear);
});

describe('the request the change is made in', () => {
    it('holds the person to the token\'s project', async () => {
        const inside = await insideARequest(async () => ({ opensElsewhere: (await canReadProject(C, PERSON, ELSEWHERE)).allowed, ...whereItRuns() }));
        expect(inside).toMatchObject({ opensElsewhere: false, narrowedTo: [IN_REACH], agent: { uid: PERSON, chat: false }, mark: mark(), request: REQUEST });
    });
});

describe('a listener on the event bus', () => {
    const traceOf = (work) => insideARequest(() => { work(); return telemetry.traceIdNow(); });

    it('is told of a task change after its window, with who made it, how deep, and its trace', async () => {
        const traceId = traceOf(() => changePriority('HIGH'));
        expect(heard).toEqual([]);
        await settle();

        expect(heard).toHaveLength(1);
        const [{ envelope, ...where }] = heard;
        expect(where).toEqual(outsideTheRequest(traceId));
        expect(envelope).toMatchObject({ type: 'task.priority_changed', companyId: C, traceId, actor: { kind: 'agent', userId: PERSON }, depth: 1 });
    });

    it('is told the same way when a second change sends the first at once', async () => {
        const traceId = traceOf(() => { changePriority('HIGH'); changePriority('URGENT'); });

        expect(heard).toHaveLength(1);
        const [{ envelope, ...where }] = heard;
        expect(where).toEqual(outsideTheRequest(traceId));
        expect(envelope).toMatchObject({ traceId, actor: { kind: 'agent', userId: PERSON }, depth: 1, data: { Task_Priority: 'HIGH' } });
    });

    it('is told the same way of a doc, a comment or a call', () => {
        const traceId = traceOf(() => domainEventBus.publishEntityEvent({ companyId: C, type: 'page.updated', entity: { kind: 'page', id: PAGE }, data: { _id: PAGE } }));

        expect(heard.map(({ envelope, ...where }) => where)).toEqual([outsideTheRequest(traceId)]);
        expect(heard[0].envelope.traceId).toBe(traceId);
    });

    it('is told the same way of a form that was sent in', () => {
        const traceId = traceOf(() => formEvent.publishFormSubmitted({ companyId: C, form: { _id: 'form-1', ProjectID: IN_REACH }, submissionId: 'sub-1', answers: [] }));

        expect(heard.map(({ envelope, ...where }) => where)).toEqual([outsideTheRequest(traceId)]);
        expect(heard[0].envelope).toMatchObject({ type: formEvent.EVENT_TYPE, traceId });
    });
});

describe('a rule the change wakes', () => {
    it('runs its step for its maker, with the maker\'s own projects', async () => {
        seedRule();
        insideARequest(() => changePriority('HIGH'));
        await settle();

        expect(steps).toHaveLength(1);
        expect(steps[0]).toMatchObject({ makerOpensElsewhere: true, narrowedTo: null, agent: null, mark: null, workspace: C });
    });

    it('still knows the change was an agent\'s, and one step deeper than what the agent answered', async () => {
        seedRule();
        insideARequest(() => changePriority('HIGH'), 1);
        await settle();

        expect(steps.map(({ actor, depth }) => ({ actor, depth }))).toEqual([{ actor: { kind: 'agent', userId: PERSON }, depth: 2 }]);
    });

    it('is not woken by an agent\'s change unless it asked to hear automated changes', async () => {
        seedRule({ reactToAutomation: false });
        insideARequest(() => changePriority('HIGH'));
        await settle();

        expect(heard.map(({ envelope }) => envelope.actor.kind)).toEqual(['agent']);
        expect(steps).toEqual([]);
    });

    it('is not woken past the depth a chain may reach', async () => {
        seedRule();
        insideARequest(() => changePriority('HIGH'), domainEventBus.MAX_DEPTH);
        await settle();

        expect(heard).toEqual([]);
        expect(steps).toEqual([]);
        expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/exceeds 3/));
    });

    it('cannot start an agent where agents are paused, or past the depth limit', async () => {
        mockDb.store[SCHEMA_TYPE.PROJECTS].find((project) => String(project._id) === IN_REACH).agentLimits = { paused: true };
        const asked = [];
        registry.getAction.mockImplementationOnce(() => ({
            run: async ({ companyId, context }) => {
                asked.push(await runs.canStart({ _id: 'agent-2', name: 'Reviewer' }, { trigger: 'rule', companyId, depth: context.depth, projectId: IN_REACH }));
                asked.push(await runs.canStart({ _id: 'agent-2', name: 'Reviewer' }, { trigger: 'rule', companyId, depth: domainEventBus.MAX_DEPTH, projectId: ELSEWHERE }));
                return { ok: true };
            },
        }));
        seedRule();
        insideARequest(() => changePriority('HIGH'));
        await settle();

        expect(asked).toEqual([
            expect.objectContaining({ ok: false, code: 'project_paused' }),
            expect.objectContaining({ ok: false, code: runs.LOOP_DEPTH_EXCEEDED }),
        ]);
    });
});

describe('a screen that is sent the change', () => {
    const screen = (roomName) => {
        const sent = [];
        const socket = { id: 's1', identity: { companyId: C, uid: PERSON }, user: { uid: PERSON }, rooms: new Set([roomName]), emit: (event) => sent.push(event) };
        const namespace = { to: () => ({ emit: (event) => sent.push(event) }) };
        upsertRoom({ roomName, socketId: socket.id, namespace, socket });
        return { sent, close: () => removeRoom(roomName) };
    };

    it('gets a comment on a doc the person looking can read, whatever the request that wrote it may open', async () => {
        mockDb.seed(SCHEMA_TYPE.PAGES, { _id: new ObjectId(PAGE), ProjectID: ELSEWHERE, deletedStatusKey: 0 });
        const own = screen(`${pageCommentRoomOf(PAGE)}**s1`);
        try {
            await insideARequest(() => relayPageComment({ type: 'insert', module: 'pageComments', companyId: C, data: { _id: 'c1', pageId: PAGE, message: 'Hi' } }));
            expect(own.sent).toEqual(['pageCommentInsert']);
        } finally {
            own.close();
        }
    });

    it('gets an agent session on a task the person looking can open, whatever the request that changed it may open', async () => {
        const own = screen(`taskDetail_${TASK}**s1`);
        try {
            await insideARequest(() => sessionRelay.relay({ companyId: C, data: { taskId: TASK, session: { state: 'open' } } }));
            expect(own.sent).toEqual([sessionRelay.EVENT]);
        } finally {
            own.close();
        }
    });
});

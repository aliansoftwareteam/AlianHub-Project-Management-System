process.env.STORAGE_TYPE = 'server';
jest.setTimeout(30000);
const mockDb = require('./fixtures/fakeMongo').create();

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

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const runs = require('../Modules/Agents/runs');
const actions = require('../Modules/Agents/actions');
const agentsCtrl = require('../Modules/Agents/controller');
const { agentPerimeter } = require('../Modules/Agents/guard');
const { holdNarrowedToken } = require('../Config/narrowedTokenRoutes');

const { CID, OWNER, INSIDER, P_OPEN, P_PRIVATE, L_OPEN, L_PRIVATE, T_OPEN, T_PRIVATE, settle } = world;
const { seed, rows } = world.create(mockDb);

const T_OPEN_2 = '6f0000000000000000000d09';
const T_NOWHERE = '6f0000000000000000000dff';
const DM_SPACE = '6f0000000000000000000ca2';
const DM = '6f0000000000000000000cd1';
const DM_IN_A_PROJECT = '6f0000000000000000000cd2';
const PAGE_PRIVATE = '6f0000000000000000000e01';
const REVIEWER = '6f0000000000000000000a11';
const OTHER_AGENT = '6f0000000000000000000a12';
const RUNS = 'POST /api/v2/agents/runs';
const PROPOSALS = 'POST /api/v2/agents/proposals';
const HANDLERS = { [RUNS]: agentsCtrl.startRun, [PROPOSALS]: agentsCtrl.createProposal };

const session = (uid) => ({ uid });
const agentToken = (uid, extra = {}) => ({ uid, apiToken: { _id: '6f0000000000000000000101', kind: 'agent', name: 'Claude', userId: uid, scopes: ['read', 'write'], ...extra } });
const personalToken = (uid, extra = {}) => ({ uid, apiToken: { _id: '6f0000000000000000000102', name: 'A script', userId: uid, scopes: ['read', 'write'], ...extra } });
const tokenOfReviewer = (uid) => agentToken(uid, { agentId: REVIEWER });

const answerTo = (run) => new Promise((resolve) => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    run(res);
}).then(async (answer) => { await settle(); return answer; });

const requestOf = (route, caller, body) => {
    const [method, url] = route.split(' ');
    return { ...caller, method, originalUrl: url, url, query: {}, params: {}, headers: { companyid: CID }, ip: '1.1.1.1', body };
};

/* What stands in front of every route, then the route's own handler. */
const send = (route, caller, body = {}) => answerTo((res) => { const req = requestOf(route, caller, body); agentPerimeter(req, res, () => HANDLERS[route](req, res)); });

/* The same with the check a token limited to some projects passes first, as the session middleware runs it. */
const sendThroughTheTokenCheck = (route, caller, body = {}) => answerTo((res) => {
    const req = requestOf(route, caller, body);
    holdNarrowedToken(req, res, () => agentPerimeter(req, res, () => HANDLERS[route](req, res)));
});

const start = (caller, taskId, body = {}) => send(RUNS, caller, { agentId: REVIEWER, taskId, trigger: 'manual', ...body });
const naming = `@[Reviewer](agent_${REVIEWER}) please check the links`;
const commentChange = (taskId) => ({ action: 'task.comment', params: { taskId, body: 'A note' } });
const propose = (caller, body) => send(PROPOSALS, caller, { what: 'Leave a note', changes: [commentChange(T_OPEN)], ...body });

const runRows = () => rows(SCHEMA_TYPE.AGENT_RUNS);
const startedByMention = () => runRows().filter((run) => run.trigger === 'mention');
const refusals = () => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.action === 'agent.action_refused');
const proposals = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS);
const project = (id) => rows(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === id);
const agentRow = (id) => rows(SCHEMA_TYPE.AGENTS).find((row) => String(row._id) === id);
const atWork = (projectId, taskId = T_OPEN_2) => mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: OTHER_AGENT, agentName: 'Reporter', taskId, projectId, status: 'running', startedBy: OWNER, startedAt: new Date() });

/* An agent a person connected, commenting through its MCP tool. */
const connected = (uid) => ({ kind: 'agent', userId: uid, agentId: null, agentName: 'Claude', tokenId: '6f0000000000000000000101', viaAccount: 'personal', personName: 'Ian Insider' });
const commentByTool = (actor, extra = {}) => actions.perform({ companyId: CID, actor, action: 'task.comment', params: { taskId: T_OPEN, body: naming }, reason: 'asked', ...extra })
    .then((out) => ({ done: true, ...out }), (error) => ({ done: false, reason: error.message }))
    .then(async (outcome) => { await settle(); return outcome; });

beforeAll(() => require('../Modules/AICore/persistence').useInMemory());

beforeEach(() => {
    jest.clearAllMocks();
    const { seedTask } = seed();
    seedTask(T_OPEN_2, 'Second open task', P_OPEN, L_OPEN);
    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: DM_SPACE, ProjectName: 'Direct messages', default: true });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: DM, TaskName: 'Olive and Ian', CompanyId: CID, ProjectID: DM_SPACE, mainChat: true, AssigneeUserId: [OWNER, INSIDER], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: DM_IN_A_PROJECT, TaskName: 'Olive and Ian again', CompanyId: CID, ProjectID: P_OPEN, sprintId: L_OPEN, mainChat: true, AssigneeUserId: [OWNER, INSIDER], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PAGES, { _id: PAGE_PRIVATE, title: 'Plan', ProjectID: P_PRIVATE, visibility: 'project', createdBy: OWNER, deletedStatusKey: 0 });
    const agent = (_id, name) => mockDb.seed(SCHEMA_TYPE.AGENTS, { _id, name, autonomy: 1, allowedActions: [], account: 'workspace', spendCapUsd: 10, paused: false, deletedStatusKey: 0, projectIds: [], skills: [{ key: 'qa-review', name: 'QA', enabled: true }] });
    agent(REVIEWER, 'Reviewer');
    agent(OTHER_AGENT, 'Reporter');
    jest.spyOn(runs, 'executeSkill').mockResolvedValue({ status: 'done' });
});

afterEach(() => runs.executeSkill.mockRestore());

describe('a run is started on a task, never on a conversation', () => {
    it.each([
        ['a signed-in owner who is in it', session(OWNER)],
        ['a signed-in member who is in it', session(INSIDER)],
        ['a personal token of a member who is in it', personalToken(INSIDER)],
    ])('%s starts none on a direct message, kept in the chat space or in a project, and is answered as for a task that is not there', async (label, caller) => {
        for (const taskId of [DM, DM_IN_A_PROJECT]) {
            const answer = await start(caller, taskId);

            expect(answer).toEqual(await start(caller, T_NOWHERE));
            expect(answer).toMatchObject({ code: 404, body: { status: false, statusText: 'Task not found.' } });
        }
        expect(runRows()).toHaveLength(0);
        expect(runs.executeSkill).not.toHaveBeenCalled();
    });

    it('a person still starts one on a task', async () => {
        expect((await start(session(INSIDER), T_OPEN)).body.status).toBe(true);
        expect(runRows()).toHaveLength(1);
    });
});

describe('a token limited to some projects', () => {
    const limited = (uid, kind) => (kind === 'agent' ? agentToken : personalToken)(uid, { projectIds: [P_OPEN] });

    it.each(['agent', 'personal'])('starts no run with an %s token on a task outside them, answered as for a task that is not there', async (kind) => {
        const answer = await start(limited(OWNER, kind), T_PRIVATE);

        expect(answer).toMatchObject({ code: 404, body: { status: false, statusText: 'Task not found.' } });
        expect(runRows()).toHaveLength(0);
    });

    it('starts a run on a task inside them', async () => {
        expect((await start(limited(OWNER, 'agent'), T_OPEN)).body.status).toBe(true);
        expect(runRows()).toHaveLength(1);
    });

    it('does not reach the run route at all through the check tokens pass first', async () => {
        const answer = await sendThroughTheTokenCheck(RUNS, limited(OWNER, 'agent'), { agentId: REVIEWER, taskId: T_OPEN, trigger: 'manual' });

        expect(answer.code).toBe(403);
        expect(answer.body.code).toBe('token_limited_to_projects');
        expect(runRows()).toHaveLength(0);
    });
});

describe('a comment an agent posts through its tool, naming a workspace agent', () => {
    it('starts that agent on the task', async () => {
        expect((await commentByTool(connected(INSIDER))).done).toBe(true);

        expect(startedByMention()).toHaveLength(1);
        expect(startedByMention()[0]).toMatchObject({ agentId: REVIEWER, taskId: T_OPEN, startedBy: INSIDER });
    });

    it('is posted and starts nothing where the project already has as many agents at work as it takes, and that is recorded', async () => {
        project(P_OPEN).agentLimits = { atOnce: 1 };
        atWork(P_OPEN);

        expect((await commentByTool(connected(INSIDER))).done).toBe(true);

        expect(rows(SCHEMA_TYPE.COMMENTS)).toHaveLength(1);
        expect(startedByMention()).toHaveLength(0);
        expect(runs.executeSkill).not.toHaveBeenCalled();
        expect(refusals()).toHaveLength(1);
        expect(refusals()[0].meta).toMatchObject({ ran: false, action: 'agent.run.start', onBehalfOf: INSIDER });
        expect(refusals()[0].meta.reason).toMatch(/already has 1 agent at work/);
    });

    it('counts the comment once toward the tasks a connected agent changes on its own in the project', async () => {
        project(P_OPEN).agentLimits = { directTasks: 1, atOnce: 5 };

        expect((await commentByTool(connected(INSIDER))).done).toBe(true);

        expect(startedByMention()).toHaveLength(1);
        expect(refusals()).toHaveLength(0);
    });

    it('starts the agent once a person approved the comment, whatever the project has at work', async () => {
        project(P_OPEN).agentLimits = { atOnce: 1 };
        atWork(P_OPEN);

        expect((await commentByTool(connected(INSIDER), { approved: true, approvedBy: OWNER })).done).toBe(true);

        expect(startedByMention()).toHaveLength(1);
        expect(refusals()).toHaveLength(0);
    });
});

describe('a proposal filed with the token of a workspace agent that works in some projects', () => {
    beforeEach(() => { agentRow(REVIEWER).projectIds = [P_OPEN]; });

    const refusedAsOutside = async (body) => {
        const answer = await propose(tokenOfReviewer(OWNER), body);

        expect(answer).toMatchObject({ code: 403, body: { status: false, statusText: 'This agent is not scoped to that project.' } });
        expect(proposals()).toHaveLength(0);
    };

    it.each([
        ['a task of another project', { taskId: T_PRIVATE, changes: [commentChange(T_PRIVATE)] }],
        ['a task of its own, with a change to a task of another project', { taskId: T_OPEN, changes: [commentChange(T_OPEN), commentChange(T_PRIVATE)] }],
        ['a task of its own, linked to a task of another project', { taskId: T_OPEN, changes: [{ action: 'task.relation.add', params: { taskId: T_OPEN, relatedTaskId: T_PRIVATE, type: 'relates_to' } }] }],
        ['another project', { projectId: P_PRIVATE, changes: [] }],
        ['a new task in another project', { changes: [{ action: 'task.create', params: { projectId: P_PRIVATE, title: 'New' } }] }],
        ['a list of another project', { changes: [{ action: 'task.sprint.move', params: { taskId: T_OPEN, sprintId: L_PRIVATE } }] }],
        ['a doc of another project', { changes: [{ action: 'page.draft', params: { taskId: T_OPEN, parentPageId: PAGE_PRIVATE, title: 'Notes', text: 'Notes' } }] }],
    ])('names nothing outside them: %s', async (label, body) => {
        await refusedAsOutside(body);
    });

    it('is filed on a task of its own projects', async () => {
        expect((await propose(tokenOfReviewer(OWNER), { taskId: T_OPEN })).body.status).toBe(true);
        expect(proposals()).toHaveLength(1);
        expect(proposals()[0]).toMatchObject({ agentId: REVIEWER, taskId: T_OPEN, projectId: P_OPEN });
    });

    it('still answers what its person cannot open as something that is not there', async () => {
        const answer = await propose(tokenOfReviewer(world.OUTSIDER), { taskId: T_PRIVATE, changes: [commentChange(T_PRIVATE)] });

        expect(answer.code).toBe(404);
        expect(proposals()).toHaveLength(0);
    });

    it('an agent that works everywhere files one on any project its person opens', async () => {
        agentRow(REVIEWER).projectIds = [];

        expect((await propose(tokenOfReviewer(OWNER), { taskId: T_PRIVATE, changes: [commentChange(T_PRIVATE)] })).body.status).toBe(true);
    });
});

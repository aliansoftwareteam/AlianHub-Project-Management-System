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
const agentsCtrl = require('../Modules/Agents/controller');
const commentsCtrl = require('../Modules/Comments/controller');
const { agentPerimeter } = require('../Modules/Agents/guard');

const { CID, OWNER, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, L_OPEN, L_SECRET, T_OPEN, T_SECRET, T_PRIVATE, settle } = world;
const { seed, rows } = world.create(mockDb);

const T_OPEN_2 = '6f0000000000000000000d09';
const T_NOWHERE = '6f0000000000000000000dff';
const DM_SPACE = '6f0000000000000000000ca2';
const DM = '6f0000000000000000000cd1';
const REVIEWER = '6f0000000000000000000a11';
const OTHER_AGENT = '6f0000000000000000000a12';
const RUNS = 'POST /api/v2/agents/runs';
const COMMENTS = 'POST /api/v1/comments';
const PROPOSALS = 'POST /api/v2/agents/proposals';
const HANDLERS = { [RUNS]: agentsCtrl.startRun, [COMMENTS]: commentsCtrl.save, [PROPOSALS]: agentsCtrl.createProposal };

const session = (uid) => ({ uid });
const agentToken = (uid, extra = {}) => ({ uid, apiToken: { _id: '6f0000000000000000000101', kind: 'agent', name: 'Claude', userId: uid, scopes: ['read', 'write'], ...extra } });
const personalToken = (uid) => ({ uid, apiToken: { _id: '6f0000000000000000000102', name: 'A script', userId: uid, scopes: ['read', 'write'] } });
const tokenOfReviewer = (uid) => agentToken(uid, { agentId: REVIEWER });

/* What stands in front of every route, then the route's own handler. */
const send = (route, caller, body = {}, headers = {}) => new Promise((resolve) => {
    const [method, url] = route.split(' ');
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const req = { ...caller, method, originalUrl: url, url, query: {}, params: {}, headers: { companyid: CID, ...headers }, ip: '1.1.1.1', body };
    agentPerimeter(req, res, () => HANDLERS[route](req, res));
}).then(async (answer) => { await settle(); return answer; });

const start = (caller, taskId, body = {}) => send(RUNS, caller, { agentId: REVIEWER, taskId, trigger: 'manual', ...body });
const naming = `@[Reviewer](agent_${REVIEWER}) please check the links`;
const comment = (caller, taskId = T_OPEN, projectId = P_OPEN, sprintId = L_OPEN) => send(COMMENTS, caller, { data: { objId: { projectId, sprintId, taskId }, message: naming, type: 'text' } });
const commentChange = (taskId) => ({ action: 'task.comment', params: { taskId, body: 'A note' } });
const propose = (caller, body, headers) => send(PROPOSALS, caller, { what: 'Leave a note', changes: [commentChange(T_OPEN)], ...body }, headers);

const runRows = () => rows(SCHEMA_TYPE.AGENT_RUNS);
const refusals = () => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.action === 'agent.action_refused');
const project = (id) => rows(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === id);
const atWork = (projectId, taskId = T_OPEN_2) => mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: OTHER_AGENT, agentName: 'Reporter', taskId, projectId, status: 'running', startedBy: OWNER, startedAt: new Date() });

/* [what the project is set to, how it is set, what the refusal says] */
const HELD = [
    ['has connected agents propose every change', () => { project(P_OPEN).agentPolicy = { connected: 'propose_all' }; }, /propose every change/],
    ['already has as many agents at work as it takes', () => { project(P_OPEN).agentLimits = { atOnce: 1 }; atWork(P_OPEN); }, /already has 1 agent at work/],
];

beforeAll(() => require('../Modules/AICore/persistence').useInMemory());

beforeEach(() => {
    jest.clearAllMocks();
    const { seedTask } = seed();
    seedTask(T_OPEN_2, 'Second open task', P_OPEN, L_OPEN);
    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: DM_SPACE, ProjectName: 'Direct messages', default: true });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: DM, TaskName: 'Olive and Ian', CompanyId: CID, ProjectID: DM_SPACE, mainChat: true, AssigneeUserId: [OWNER, INSIDER], deletedStatusKey: 0 });
    const agent = (_id, name) => mockDb.seed(SCHEMA_TYPE.AGENTS, { _id, name, autonomy: 1, allowedActions: [], account: 'workspace', spendCapUsd: 10, paused: false, deletedStatusKey: 0, projectIds: [], skills: [{ key: 'qa-review', name: 'QA', enabled: true }] });
    agent(REVIEWER, 'Reviewer');
    agent(OTHER_AGENT, 'Reporter');
    jest.spyOn(runs, 'executeSkill').mockResolvedValue({ status: 'done' });
});

afterEach(() => runs.executeSkill.mockRestore());

describe('a run started with a token created for an agent', () => {
    it.each([
        ['in a private project its person is not on', OUTSIDER, T_PRIVATE],
        ['in a private list its person is not on', OUTSIDER, T_SECRET],
        ['for a guest, who starts none', GUEST, T_OPEN],
        ['on a direct message its person is in', OWNER, DM],
    ])('is not started %s, and is answered as a task that is not there', async (label, uid, taskId) => {
        const answer = await start(agentToken(uid), taskId);

        expect(answer).toEqual(await start(agentToken(uid), T_NOWHERE));
        expect(answer).toMatchObject({ code: 404, body: { status: false, statusText: 'Task not found.' } });
        expect(runRows()).toHaveLength(0);
        expect(runs.executeSkill).not.toHaveBeenCalled();
    });

    it.each([
        ['in a private list its person is on', INSIDER, T_SECRET],
        ['in a private project its person owns the company of', OWNER, T_PRIVATE],
        ['in an open project', OUTSIDER, T_OPEN],
    ])('is started on a task %s, in the name of that person', async (label, uid, taskId) => {
        const answer = await start(agentToken(uid), taskId);

        expect(answer.body.status).toBe(true);
        expect(runRows()).toHaveLength(1);
        expect(runRows()[0]).toMatchObject({ agentId: REVIEWER, taskId, trigger: 'manual', startedBy: uid });
        expect(refusals()).toHaveLength(0);
    });

    it.each(HELD)('is refused where the project %s, and recorded', async (label, set, reason) => {
        set();
        const before = runRows().length;

        const answer = await start(agentToken(INSIDER), T_OPEN);

        expect(answer.code).toBe(403);
        expect(answer.body.statusText).toMatch(reason);
        expect(runRows()).toHaveLength(before);
        expect(runs.executeSkill).not.toHaveBeenCalled();
        expect(refusals()).toHaveLength(1);
        expect(refusals()[0].meta).toMatchObject({ ran: false, action: 'agent.run.start', path: RUNS, onBehalfOf: INSIDER });
    });

    it('is refused where agents are paused in the project', async () => {
        project(P_OPEN).agentLimits = { paused: true };

        expect((await start(agentToken(INSIDER), T_OPEN)).code).toBe(409);
        expect(runRows()).toHaveLength(0);
    });

    it('counts toward the tasks a connected agent changes on its own in the project', async () => {
        project(P_OPEN).agentLimits = { directTasks: 1, atOnce: 5 };

        expect((await start(agentToken(INSIDER), T_OPEN)).body.status).toBe(true);
        const second = await start(agentToken(INSIDER), T_OPEN_2);

        expect(second.code).toBe(403);
        expect(second.body.statusText).toMatch(/already changed 1 task/);
        expect(runRows()).toHaveLength(1);
    });

    it.each([
        ['a signed-in member', session(INSIDER)],
        ['a personal token of a member', personalToken(INSIDER)],
    ])('leaves %s the rule a person has', async (label, caller) => {
        HELD.forEach(([, set]) => set());

        expect((await start(caller, T_OPEN)).body.status).toBe(true);
        expect(runRows().filter((run) => run.agentId === REVIEWER)).toHaveLength(1);
        expect(refusals()).toHaveLength(0);
    });
});

describe('a comment that names a workspace agent, posted with a token created for an agent', () => {
    const startedByMention = () => runRows().filter((run) => run.trigger === 'mention');

    it('starts that agent on a task its person can open', async () => {
        expect((await comment(agentToken(INSIDER))).code).toBe(200);

        expect(startedByMention()).toHaveLength(1);
        expect(startedByMention()[0]).toMatchObject({ agentId: REVIEWER, taskId: T_OPEN, startedBy: INSIDER });
    });

    it.each(HELD)('is posted and starts nothing where the project %s, and that is recorded', async (label, set) => {
        set();

        expect((await comment(agentToken(INSIDER))).code).toBe(200);

        expect(rows(SCHEMA_TYPE.COMMENTS)).toHaveLength(1);
        expect(startedByMention()).toHaveLength(0);
        expect(runs.executeSkill).not.toHaveBeenCalled();
        expect(refusals()).toHaveLength(1);
        expect(refusals()[0].meta).toMatchObject({ ran: false, action: 'agent.run.start', path: COMMENTS, onBehalfOf: INSIDER });
    });

    it.each([
        ['where agents are paused in the project', INSIDER, () => { project(P_OPEN).agentLimits = { paused: true }; }],
        ['for a guest', GUEST, () => {}],
    ])('starts nothing %s', async (label, uid, set) => {
        set();

        await comment(agentToken(uid));

        expect(startedByMention()).toHaveLength(0);
    });

    it.each([
        ['a signed-in member', session(INSIDER)],
        ['a personal token of a member', personalToken(INSIDER)],
    ])('leaves %s the rule a person has', async (label, caller) => {
        HELD.forEach(([, set]) => set());

        expect((await comment(caller)).code).toBe(200);

        expect(startedByMention()).toHaveLength(1);
        expect(refusals()).toHaveLength(0);
    });
});

describe('a proposal filed with the token of a workspace agent', () => {
    const proposals = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS);
    const nothingFiled = async (uid, body, headers) => {
        const answer = await propose(tokenOfReviewer(uid), body, headers);

        expect(answer).toEqual(await propose(tokenOfReviewer(uid), { taskId: T_NOWHERE, changes: [commentChange(T_NOWHERE)] }));
        expect(answer.code).toBe(404);
        expect(proposals()).toHaveLength(0);
    };

    it.each([
        ['a task in a private project', { taskId: T_PRIVATE, changes: [commentChange(T_PRIVATE)] }],
        ['a task in a private list', { taskId: T_SECRET, changes: [commentChange(T_SECRET)] }],
        ['an open task, with a change to a hidden one', { taskId: T_OPEN, changes: [commentChange(T_OPEN), commentChange(T_SECRET)] }],
        ['an open task, linked to a hidden one', { taskId: T_OPEN, changes: [{ action: 'task.relation.add', params: { taskId: T_OPEN, relatedTaskId: T_PRIVATE, type: 'relates_to' } }] }],
        ['a private project', { projectId: P_PRIVATE }],
        ['a change in a private project', { changes: [{ action: 'task.create', params: { projectId: P_PRIVATE, title: 'New' } }] }],
        ['a change in a private list', { changes: [{ action: 'task.create', params: { projectId: P_OPEN, sprintId: L_SECRET, title: 'New' } }] }],
    ])('names nothing its person cannot open: %s', async (label, body) => {
        await nothingFiled(OUTSIDER, body);
    });

    it('is not filed on a direct message its person is in', async () => {
        await nothingFiled(OWNER, { taskId: DM, changes: [commentChange(DM)] });
    });

    it('is filed as that agent\'s, whatever the request says of who asks', async () => {
        const answer = await propose(tokenOfReviewer(INSIDER), {
            taskId: T_SECRET, changes: [commentChange(T_SECRET)], source: 'mcp', requestedBy: OWNER, tokenId: 'another', allowedActions: ['task.delete'], agentName: 'Olive Owner',
        });

        expect(answer.body.status).toBe(true);
        expect(proposals()).toHaveLength(1);
        expect(proposals()[0]).toMatchObject({ agentId: REVIEWER, agentName: 'Reviewer', taskId: T_SECRET, projectId: P_OPEN, status: 'pending' });
        ['source', 'requestedBy', 'tokenId', 'allowedActions'].forEach((field) => expect(proposals()[0][field]).toBeUndefined());
    });

    it.each([
        ['a run of another agent', { agentId: OTHER_AGENT, taskId: T_OPEN, projectId: P_OPEN }, INSIDER],
        ['a run on a task its person cannot open', { agentId: REVIEWER, taskId: T_PRIVATE, projectId: P_PRIVATE }, OUTSIDER],
    ])('is not filed from %s, named in the request or in its header', async (label, run, uid) => {
        const runId = String(mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentName: 'Reviewer', status: 'waiting_approval', startedBy: OWNER, startedAt: new Date(), ...run })._id);

        await nothingFiled(uid, { taskId: T_OPEN, runId });
        await nothingFiled(uid, { taskId: T_OPEN }, { 'x-agent-run': runId });
    });

    it('is filed from a run of its own on a task its person can open', async () => {
        const runId = String(mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: REVIEWER, agentName: 'Reviewer', taskId: T_OPEN, projectId: P_OPEN, status: 'running', startedBy: INSIDER, startedAt: new Date() })._id);

        expect((await propose(tokenOfReviewer(INSIDER), { taskId: T_OPEN, runId })).body.status).toBe(true);
        expect(proposals()[0]).toMatchObject({ runId, agentId: REVIEWER });
    });

    it('keeps the approval its changes need, whatever lighter one the request names', async () => {
        const answer = await propose(tokenOfReviewer(OWNER), { changes: [{ action: 'deploy.staging', params: {} }], gate: 'member' });

        expect(answer.body.status).toBe(true);
        expect(proposals()[0].gate).toBe('owner_admin');
    });

    it('is refused where agents are paused in the project, and recorded', async () => {
        project(P_OPEN).agentLimits = { paused: true };

        const answer = await propose(tokenOfReviewer(INSIDER), { taskId: T_OPEN });

        expect(answer.code).toBe(403);
        expect(proposals()).toHaveLength(0);
        expect(refusals()).toHaveLength(1);
        expect(refusals()[0].meta).toMatchObject({ ran: false, action: 'task.comment', path: PROPOSALS, onBehalfOf: INSIDER });
    });
});

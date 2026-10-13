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
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/AICore/aiSwitch', () => ({ AI_OFF: 'ai_off', allowed: jest.fn(async () => true), assertAllowed: jest.fn(async () => {}), isAiOff: () => false }));
jest.mock('../Modules/PublicShares/helpers/shareAccess', () => ({
    canManageShare: async () => ({ ok: true, statusCode: 200 }),
    shareStillAuthorised: async () => true,
    shareIsLive: async (companyId, share) => Boolean(share) && share.enabled !== false,
}));

const fs = require('fs');

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const { matches } = require('./fixtures/fakeMongo');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, P_OPEN, L_OPEN, T_OPEN, settle } = world;
const { seed, rows } = world.create(mockDb);

const CONVERSATION = '6f0000000000000000000cd2';
const TWIN = '6f0000000000000000000cd3';
const PORTFOLIO = '6f0000000000000000000e21';
const SHARE = '6f0000000000000000000e22';
const SHARE_TOKEN = 'ab'.repeat(32);
const { hashFeedToken } = require('../Modules/Calendar/helpers/icalRules');
const IN_IT = [ADMIN, INSIDER];
const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (days) => new Date(Date.now() + days * DAY);

/* A conversation kept in the open project and its open list, and beside it an ordinary task that is alike in every
 * field a read could ask about. A read that takes the task and leaves the conversation is reading work. */
const alike = (extra) => ({
    TaskName: 'Adam and Ian', TaskKey: 'OPE-9', CompanyId: CID, ProjectID: P_OPEN, sprintId: L_OPEN, sprintArray: { id: L_OPEN, name: 'Open list' },
    isParentTask: true, ancestors: [], deletedStatusKey: 0, statusKey: 3, statusType: 'close', status: { text: 'Done', key: 3, type: 'close' }, Task_Priority: 'HIGH',
    TaskType: 'task', TaskTypeKey: 1, AssigneeUserId: IN_IT, Task_Leader: ADMIN, watchers: [], points: 3, totalEstimatedTime: 120,
    DueDate: daysFromNow(2), startDate: daysFromNow(-2), rawDescription: 'https://example.com/shared', description: 'Shared', links: [], tagsArray: [],
    createdAt: daysFromNow(-5), updatedAt: daysFromNow(-1), ...extra,
});

const seedWorld = () => {
    seed();
    const list = rows(SCHEMA_TYPE.SPRINTS).find((row) => String(row._id) === L_OPEN);
    Object.assign(list, {
        isScrum: true, state: 'closed', startDate: daysFromNow(-14), endDate: daysFromNow(-1),
        commitment: { at: daysFromNow(-14), points: 6, taskIds: [T_OPEN, TWIN, CONVERSATION] }, closeReport: { at: daysFromNow(-1) },
    });
    mockDb.seed(SCHEMA_TYPE.TASKS, alike({ _id: TWIN }));
    mockDb.seed(SCHEMA_TYPE.TASKS, alike({ _id: CONVERSATION, mainChat: true }));
    mockDb.seed(SCHEMA_TYPE.PORTFOLIOS, { _id: PORTFOLIO, name: 'All', projectIds: [P_OPEN], createdBy: OWNER, deletedStatusKey: 0 });
    [OWNER, ADMIN, INSIDER, OUTSIDER].forEach((userId) => mockDb.seed(SCHEMA_TYPE.CALENDAR_FEEDS, { tokenHash: hashFeedToken(userId), companyId: CID, userId, scope: 'all', name: 'Mine', enabled: true, deletedStatusKey: 0 }));
    mockDb.seed(SCHEMA_TYPE.PUBLIC_SHARES, { _id: SHARE, entityType: 'sprint', entityId: L_OPEN, token: SHARE_TOKEN, enabled: true });
    mockDb.seed(SCHEMA_TYPE.PUBLIC_SHARE_INDEX, { token: SHARE_TOKEN, companyId: CID, shareId: SHARE });
    [TWIN, CONVERSATION].forEach((taskId) => mockDb.seed(SCHEMA_TYPE.TIMESHEET, {
        TicketID: taskId, ProjectId: P_OPEN, Loggeduser: ADMIN, LogTimeDuration: 30, LogStartTime: Math.floor(Date.now() / 1000) - 3600, LogEndTime: Math.floor(Date.now() / 1000) - 1800,
    }));
};

const row = (id) => rows(SCHEMA_TYPE.TASKS).find((task) => String(task._id) === id);

const READS = ['find', 'findOne', 'aggregate', 'countDocuments'];
const leadingMatches = (pipeline) => { const cut = pipeline.findIndex((stage) => !stage.$match); return (cut < 0 ? pipeline : pipeline.slice(0, cut)).map((stage) => stage.$match); };
const selects = (call, task) => (call.method === 'aggregate' ? leadingMatches(call.data[0]) : [call.data[0] || {}]).every((filter) => matches(task, filter));

/* A read that takes ids alone is how a rule is built from the rows it leaves out; it hands nothing back. */
const idsAlone = (call) => call.method === 'find' && JSON.stringify(call.data[1]) === JSON.stringify({ _id: 1 });

/* The reads of the tasks a request made, and which of the two rows each would hand back. */
const readsOf = async (run) => {
    mockDb.calls.length = 0;
    await run();
    await settle();
    const reads = mockDb.calls.filter((call) => call.type === SCHEMA_TYPE.TASKS && READS.includes(call.method) && !idsAlone(call));
    return { task: reads.some((call) => selects(call, row(TWIN))), conversation: reads.some((call) => selects(call, row(CONVERSATION))) };
};

const answered = (handler, req) => new Promise((resolve) => {
    const res = { statusCode: 200, setHeader: () => {}, set: () => res, on: () => {} };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    Promise.resolve(handler({ headers: { companyid: CID }, aud: CID, query: {}, params: {}, body: {}, ip: '1.1.1.1', ...req }, res)).catch((error) => resolve({ code: 500, error }));
});

const ofProject = { query: { projectId: P_OPEN } };
const ofList = { query: { sprintId: L_OPEN } };
const EVERYONE = [OWNER, ADMIN, INSIDER, OUTSIDER];
const OWNER_AND_ADMIN = [OWNER, ADMIN];
const ANYONE = [''];
const stillOpen = () => [TWIN, CONVERSATION].forEach((id) => Object.assign(row(id), { statusKey: 1, statusType: 'default_active', status: { text: 'To Do', key: 1 } }));
const today = () => new Date().toISOString().slice(0, 10);

/* [what is read, how it is asked for `uid`, by whom when not by everyone, what the two rows are first set to] */
const WORK_READS = {
    'the velocity of a project': (uid) => answered(require('../Modules/AgileReports/velocity').getVelocity, { uid, ...ofProject }),
    'the flow of a project': (uid) => answered(require('../Modules/AgileReports/cfd').getCFD, { uid, ...ofProject }),
    'the insights of a list': (uid) => answered(require('../Modules/AgileReports/sprintInsights').getSprintInsights, { uid, ...ofList }),
    'who did the work of a list': (uid) => answered(require('../Modules/AgileReports/provenance').getProvenance, { uid, ...ofList }),
    'who did the work of a project': (uid) => answered(require('../Modules/AgileReports/provenance').getProvenance, { uid, ...ofProject }),
    'the milestones of a project': (uid) => answered(require('../Modules/AgileReports/milestones').getMilestones, { uid, ...ofProject }),
    'the burndown of a list': (uid) => answered(require('../Modules/Sprints/burndown').getSprintBurndown, { uid, body: { sprintId: L_OPEN } }),
    'what closing a list would leave': (uid) => answered(require('../Modules/Sprints/scrum').completePreview, { uid, ...ofList }),
    'the report of a closed list': (uid) => answered(require('../Modules/Sprints/scrum').sprintReport, { uid, ...ofList }),
    'the rollup of a portfolio': (uid) => answered(require('../Modules/Portfolio/controller').getRollup, { uid, params: { id: PORTFOLIO } }),
    'estimate against time, by task': (uid) => answered(require('../Modules/VarianceReport/controller').getVarianceReport, { uid, ...ofProject }),
    'the dashboard of a project': [(uid) => answered(require('../Modules/ProjectDashboard/controller').getProjectDashboard, { uid, params: { projectId: P_OPEN } }), [OWNER, ADMIN, INSIDER]],
    'estimate against time, by person': [(uid) => answered(require('../Modules/VarianceReport/controller').getVarianceSummary, { uid, query: { from: '2020-01-01', to: today() } }), OWNER_AND_ADMIN],
    'a report someone builds': (uid) => require('../Modules/CustomReports/controller').runConfig(CID, { source: 'tasks', dimension: 'status', metric: 'count', chartType: 'bar', filters: {} }, uid),
    'what a client sees of a project': (uid) => answered(require('../Modules/Milestone/controller/clientView').getClientView, { uid, ...ofProject }),
    'the calendar feed of a person': (uid) => answered(require('../Modules/Calendar/controller').getIcs, { params: { token: uid } }),
    'the export of a project': (uid) => answered(require('../Modules/ExportJobs/controller').createExport, { uid, body: { format: 'csv', projectId: P_OPEN, projectName: 'Open' } }),
    'the export of the workspace': [(uid) => answered(require('../Modules/ExportJobs/controller').createWorkspaceExport, { uid, body: { format: 'csv' } }), OWNER_AND_ADMIN],
    'the page of a list shared by link': [() => answered(require('../Modules/PublicShares/publicRenderer').renderShare, { params: { token: SHARE_TOKEN }, method: 'GET', headers: {} }), ANYONE],
    'the tasks a copy of a project takes': [() => require('../Modules/ProjectDuplicate/tasks').planTasks(CID, P_OPEN, [L_OPEN]), ANYONE],
    'the tasks an agent could be put on': [(uid) => answered(require('../Modules/Agents/controller').routableTasks, { uid }), EVERYONE, stillOpen],
    'what was done since the last release': (uid) => require('../Modules/Agents/shipping').releaseCandidate(CID, uid, {}),
    'the tasks a rule would act on': (uid) => answered(require('../Modules/Automations/controller').preview, { uid, body: { conditions: {} } }),
    'what Ask reads for a question': [(uid) => require('../Modules/AI/ask').gather(CID, uid, { question: 'Adam and Ian' }), EVERYONE, stillOpen],
    'what the knowledge search reads': (uid) => require('../Modules/Knowledge/retrieval').retrieve({ companyId: CID, caller: { kind: 'user', userId: uid }, query: 'Adam Ian' }),
    'the tasks a rule would have reached': (uid) => answered(require('../Modules/Automations/controller').backtest, { uid, body: { rule: { version: 2, trigger: { event: 'task.created' }, conditions: {}, actions: [] } } }),
};

/* [what is read, how it is asked for `uid` of the row `taskId`, by whom when not by everyone] */
const WORK_READS_BY_ID = {
    'a task pinned to a question': (uid, taskId) => require('../Modules/AI/askContext').pinnedSources(CID, uid, { context: [{ kind: 'task', id: taskId }], projects: [{ _id: P_OPEN, ProjectName: 'Open' }] }),
    'a template made of a task': (uid, taskId) => answered(require('../Modules/TaskTemplates/controller').saveTemplate, { uid, body: { name: 'A template', taskId } }),
    'a skill tried on a task': (uid, taskId) => require('../Modules/Agents/skillDryRun').dryRun(CID, 'qa-review', { taskId, uid }).catch(() => null),
    'a task an answer cited': (uid, taskId) => require('../Modules/AI/askThreads').openSources(CID, uid, [{ kind: 'task', sourceId: taskId }]),
    'a workflow tried on a task': [(uid, taskId) => answered(require('../Modules/Workflows/controller').dryRun, { uid, body: { steps: [{ id: 'a', type: 'wait', seconds: 1 }], taskId } }), OWNER_AND_ADMIN],
};

beforeEach(seedWorld);

beforeAll(() => {
    process.env.WORKFLOW_ENGINE = 'on';
    jest.spyOn(fs.promises, 'mkdir').mockResolvedValue();
    jest.spyOn(fs.promises, 'writeFile').mockResolvedValue();
});
afterAll(() => { delete process.env.WORKFLOW_ENGINE; jest.restoreAllMocks(); });

describe('a conversation kept in a project is no work', () => {
    it.each(Object.entries(WORK_READS))('%s reads the tasks and not the conversation, for the people in it and for everyone else', async (name, door) => {
        const [ask, callers = EVERYONE, prepare = () => {}] = [].concat(door);
        prepare();

        for (const uid of callers) {
            expect([uid, await readsOf(() => ask(uid))]).toEqual([uid, { task: true, conversation: false }]);
        }
    });

    it.each(Object.entries(WORK_READS_BY_ID))('%s reads a task that is named and not a conversation that is, for the people in it and for everyone else', async (name, door) => {
        const [ask, callers = EVERYONE] = [].concat(door);

        for (const uid of callers) {
            expect([uid, 'a task', (await readsOf(() => ask(uid, TWIN))).task]).toEqual([uid, 'a task', true]);
            expect([uid, 'a conversation', (await readsOf(() => ask(uid, CONVERSATION))).conversation]).toEqual([uid, 'a conversation', false]);
        }
    });
});

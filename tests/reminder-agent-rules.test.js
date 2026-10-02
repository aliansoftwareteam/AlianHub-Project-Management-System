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
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ publishCommentChanged: jest.fn(), publishGuideSaved: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const actions = require('../Modules/Agents/actions');
const { agentPerimeter } = require('../Modules/Agents/guard');

const { CID, OWNER, INSIDER, OUTSIDER, P_OPEN, P_PRIVATE, T_OPEN, T_SECRET, T_PRIVATE, settle } = world;
const { seed, rows } = world.create(mockDb);

const T_NOWHERE = '6f0000000000000000000dff';
const DM_IN_A_PROJECT = '6f0000000000000000000cd2';
const REMINDER = '6f0000000000000000000e11';
const WHEN = '2030-01-01T09:00:00.000Z';

const CREATE = 'POST /api/v1/reminders';
const LIST = 'GET /api/v1/reminders';
const CHANGE = 'PATCH /api/v1/reminders/:id';
const RUN_NOW = 'POST /api/v1/reminders/:id/run-now';
const RUN_DUE = 'POST /api/v1/reminders/run-due';

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers; };
const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
require('../Modules/Reminders/routes').init(app);

const session = (uid) => ({ uid });
const agentToken = (uid) => ({ uid, apiToken: { _id: '6f0000000000000000000101', kind: 'agent', name: 'Claude', userId: uid, scopes: ['read', 'write'] } });
const personalToken = (uid) => ({ uid, apiToken: { _id: '6f0000000000000000000102', name: 'A script', userId: uid, scopes: ['read', 'write'] } });
const agentRun = (uid) => ({ uid, agentRun: { _id: '6f0000000000000000000103', agentId: '6f0000000000000000000104', agentName: 'Triage' } });

/* What stands in front of every route, then the route's own guards and its handler. */
const ask = (route, caller, { body = {}, params = {} } = {}) => new Promise((resolve) => {
    const [method, path] = route.split(' ');
    const url = path.replace(':id', params.id || '');
    const res = { statusCode: 200, on: (event, fn) => { if (event === 'finish') res.finish = fn; } };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { if (res.finish) res.finish(); resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const req = { ...caller, method, originalUrl: url, url, query: {}, params, headers: { companyid: CID }, aud: CID, ip: '1.1.1.1', body };
    const chain = [agentPerimeter, ...routes[route]];
    const step = (at) => Promise.resolve(chain[at](req, res, () => step(at + 1)));
    step(0);
}).then(async (answer) => { await settle(); return answer; });

const reminders = () => rows(SCHEMA_TYPE.REMINDERS);
const notices = () => rows(SCHEMA_TYPE.NOTIFICATIONS);
const audits = (action) => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.action === action);
const refusedActions = () => audits('agent.action_refused').map((row) => row.meta.action);
const stored = (id) => reminders().find((row) => String(row._id) === id);

const AGENTS = [['a token created for an agent', agentToken], ['an agent run', agentRun]];
const PEOPLE = [['a signed-in person', session], ['a personal token', personalToken]];

beforeEach(() => {
    seed();
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: DM_IN_A_PROJECT, TaskName: 'Olive and Ian', CompanyId: CID, ProjectID: P_OPEN, mainChat: true, AssigneeUserId: [OWNER, INSIDER], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.REMINDERS, { _id: REMINDER, userId: OWNER, createdBy: OWNER, companyId: CID, reminderText: 'Call the client', reminderAt: new Date(Date.now() - 1000), fired: false, deletedStatusKey: 0 });
});

describe('a task reminder set by an agent on the reminder route', () => {
    it('an agent run sets one for its person on a task that person can open, and it is recorded', async () => {
        const answer = await ask(CREATE, agentRun(INSIDER), { body: { taskId: T_SECRET, reminderAt: WHEN, reminderText: 'Check the review' } });

        expect(answer.body.status).toBe(true);
        expect(reminders().filter((row) => String(row.taskId) === T_SECRET)).toEqual([expect.objectContaining({ userId: INSIDER, createdBy: INSIDER, reminderText: 'Check the review', fired: false })]);
        expect(audits('agent.action')).toHaveLength(1);
        expect(audits('agent.action')[0].meta).toMatchObject({ action: 'reminder.create', state: 'applied', reason: 'via REST', onBehalfOf: INSIDER });
    });

    it('an agent run sets it for its own person, whoever the request names', async () => {
        await ask(CREATE, agentRun(INSIDER), { body: { taskId: T_OPEN, reminderAt: WHEN, userId: OWNER, createdBy: OWNER } });

        expect(reminders().filter((row) => String(row.taskId) === T_OPEN).map((row) => [row.userId, row.createdBy])).toEqual([[INSIDER, INSIDER]]);
    });

    /* A reminder cannot be undone, and a connected agent's change that cannot be undone waits for a person. */
    it('a token created for an agent sets none on the route, where the change would have to wait for a person, and that is recorded', async () => {
        const answer = await ask(CREATE, agentToken(INSIDER), { body: { taskId: T_OPEN, reminderAt: WHEN, reminderText: 'Check the review' } });

        expect(answer.code).toBe(403);
        expect(answer.body.statusText).toMatch(/cannot be undone/);
        expect(reminders()).toHaveLength(1);
        expect(refusedActions()).toEqual(['reminder.create']);
    });

    it.each([
        ['a task in a private project its person is not on', { taskId: T_PRIVATE }],
        ['a task in a private list its person is not on', { taskId: T_SECRET }],
        ['a task that is not there', { taskId: T_NOWHERE }],
        ['a conversation', { taskId: DM_IN_A_PROJECT }],
        ['no task', {}],
        ['a project alone', { projectId: P_OPEN }],
        ['a task it can open, with another project', { taskId: T_OPEN, projectId: P_PRIVATE }],
    ])('an agent sets none that names %s, and each is answered alike', async (label, named) => {
        const before = reminders().length;
        const uid = named.taskId === DM_IN_A_PROJECT ? INSIDER : OUTSIDER;

        /* Each refusal is recorded under an id of its own, which is all that tells two of them apart. */
        const answered = async (body) => {
            const answer = await ask(CREATE, agentToken(uid), { body });
            return { code: answer.code, said: { ...answer.body, auditId: undefined } };
        };

        const answer = await answered({ ...named, reminderAt: WHEN });

        expect(answer).toEqual(await answered({ taskId: T_NOWHERE, reminderAt: WHEN }));
        expect(answer.code).toBe(403);
        expect(reminders()).toHaveLength(before);
    });

    it('is refused where agents are paused in the project, and recorded', async () => {
        rows(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === P_OPEN).agentLimits = { paused: true };

        const answer = await ask(CREATE, agentToken(INSIDER), { body: { taskId: T_OPEN, reminderAt: WHEN } });

        expect(answer.code).toBe(403);
        expect(reminders()).toHaveLength(1);
        expect(refusedActions()).toEqual(['reminder.create']);
    });

    it.each(PEOPLE)('%s sets one as before, with a task or without', async (label, as) => {
        expect((await ask(CREATE, as(INSIDER), { body: { reminderAt: WHEN, reminderText: 'Lunch' } })).body.status).toBe(true);
        expect((await ask(CREATE, as(INSIDER), { body: { taskId: T_OPEN, projectId: P_OPEN, reminderAt: WHEN } })).body.status).toBe(true);
        expect(reminders().filter((row) => row.userId === INSIDER)).toHaveLength(2);
        expect(audits('agent.action')).toHaveLength(0);
    });
});

describe('the other reminder routes', () => {
    /* [what is asked, the route, its body] of a reminder of the owner, asked with an agent of that owner. */
    const WRITES = [
        ['changing a reminder', CHANGE, { reminderText: 'Changed', reminderAt: WHEN }],
        ['sending a reminder now', RUN_NOW, {}],
        ['sending every reminder that is due', RUN_DUE, {}],
    ];

    it.each(AGENTS.flatMap(([who, as]) => WRITES.map(([what, route, body]) => [what, who, as, route, body])))('%s is refused for %s, and recorded', async (what, who, as, route, body) => {
        const answer = await ask(route, as(OWNER), { body, params: { id: REMINDER } });

        expect([answer.code, answer.body.statusText]).toEqual([403, 'That action is not available to agents (reminder.manage).']);
        expect(stored(REMINDER)).toMatchObject({ reminderText: 'Call the client', fired: false });
        expect(notices()).toHaveLength(0);
        expect(refusedActions()).toEqual(['reminder.manage']);
    });

    it.each(PEOPLE.flatMap(([who, as]) => WRITES.map(([what, route, body]) => [what, who, as, route, body])))('%s stays with %s', async (what, who, as, route, body) => {
        const answer = await ask(route, as(OWNER), { body, params: { id: REMINDER } });

        expect(answer.body.status).toBe(true);
        expect(audits('agent.action_refused')).toHaveLength(0);
    });

    it.each([...AGENTS, ...PEOPLE])('%s reads the reminders of its person', async (label, as) => {
        expect((await ask(LIST, as(OWNER))).body.data.map((row) => row.reminderText)).toEqual(['Call the client']);
    });
});

describe('a reminder an agent sets as one of its actions', () => {
    const run = (uid) => ({ kind: 'agent', userId: uid, agentId: '6f0000000000000000000a11', agentName: 'Reviewer', runId: '6f0000000000000000000a12', viaAccount: 'workspace', tokenId: null });
    const perform = (uid, params) => actions.perform({ companyId: CID, actor: run(uid), action: 'reminder.create', params, reason: 'a run', allowedActions: ['reminder.create'] })
        .then((out) => ({ done: true, result: out.result }), (error) => ({ done: false, name: error.name, reason: error.message }))
        .then(async (outcome) => { await settle(); return outcome; });

    it('is set for the person behind the agent, on the task named', async () => {
        const out = await perform(INSIDER, { taskId: T_SECRET, reminderAt: WHEN, reminderText: 'Check the review' });

        expect(out).toMatchObject({ done: true, result: { reminderId: expect.any(String) } });
        expect(stored(out.result.reminderId)).toMatchObject({ userId: INSIDER, createdBy: INSIDER, reminderText: 'Check the review', fired: false, deletedStatusKey: 0 });
        expect(String(stored(out.result.reminderId).taskId)).toBe(T_SECRET);
        expect(String(stored(out.result.reminderId).projectId)).toBe(P_OPEN);
    });

    it.each([
        ['a task its person cannot open', OUTSIDER, { taskId: T_SECRET, reminderAt: WHEN }],
        ['a conversation its person is in', INSIDER, { taskId: DM_IN_A_PROJECT, reminderAt: WHEN }],
        ['no time', INSIDER, { taskId: T_OPEN }],
        ['a time that is not one', INSIDER, { taskId: T_OPEN, reminderAt: 'soon' }],
    ])('is not set with %s', async (label, uid, params) => {
        const out = await perform(uid, params);

        expect(out.done).toBe(false);
        expect(out.reason).not.toMatch(/has no executor/);
        expect(reminders()).toHaveLength(1);
    });
});

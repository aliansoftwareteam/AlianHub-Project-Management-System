/* A formula or a rollup is worked out again after the write that moved it, and that work belongs to no request:
   it runs under no token's project list, no agent's mark and no request of its own. Real sockets over a fake database. */
const { create } = require('./fixtures/fakeMongo');

const mockDbs = {};
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, ...rest) => {
        const db = mockDbs[String(companyId)];
        return db ? db.crud(companyId, ...rest) : Promise.resolve(null);
    },
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/settings/securityPermissions/controller', () => ({ fetchRules: jest.fn(async () => require('./fixtures/taskListRules').taskListRules()) }));
jest.mock('../Config/jwt', () => ({ resolveAccessSession: jest.fn(async () => ({ ok: true })) }));

const http = require('http');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const { io: connectClient } = require('socket.io-client');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const computedRefresh = require('../Modules/CustomField/computedRefresh');
const { runNarrowed, narrowingFor } = require('../Config/tokenNarrowing');
const { runForAgentOf, agentOf } = require('../Config/agentRequest');
const actingAgent = require('../Modules/Agents/actingAgent');
const requestContext = require('../Config/requestContext');
const { forgetVerdicts } = require('../socket/roomAccess');

const SECRET = 'computed-refresh-own-context-secret';
const C1 = '6f00000000000000000c0c01';
const PERSON = '6f00000000000000000c0011';
const COLLEAGUE = '6f00000000000000000c0012';
const TENFOLD = '6f00000000000000000c0f01';
const PARENT_ELSEWHERE = '6f00000000000000000c0701';
const CHILD_ELSEWHERE = '6f00000000000000000c0702';
const TASK_IN_REACH = '6f00000000000000000c0703';
const DEBOUNCE_MS = 40;

let server;
let baseURL;
let ids;
const open = [];

const db = () => mockDbs[C1];
const row = (_id, projectId, sprintId, parent = '') => ({
    _id: new ObjectId(_id), CompanyId: C1, TaskName: _id, ProjectID: new ObjectId(projectId), sprintId: new ObjectId(sprintId), ParentTaskId: parent,
    isParentTask: !parent, TaskTypeKey: 1, deletedStatusKey: 0, subTasks: 0, AssigneeUserId: [], customField: {},
});

const seed = () => {
    mockDbs[C1] = create();
    [[PERSON, 3], [COLLEAGUE, 3]].forEach(([userId, roleType]) => db().seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    const project = (ProjectName) => String(db().seed(SCHEMA_TYPE.PROJECTS, { _id: new ObjectId(), ProjectName, isPrivateSpace: true, AssigneeUserId: [PERSON, COLLEAGUE] })._id);
    const list = (projectId) => String(db().seed(SCHEMA_TYPE.SPRINTS, { _id: new ObjectId(), projectId, private: false, AssigneeUserId: [] })._id);
    const inReach = project('In reach');
    const elsewhere = project('Elsewhere');
    ids = { inReach, elsewhere, inReachList: list(inReach), elsewhereList: list(elsewhere) };
    db().seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: new ObjectId(TENFOLD), fieldTitle: 'Tenfold', fieldType: 'formula', type: 'task', global: true, formulaExpression: '{subtask_count} * 10' });
    db().seed(SCHEMA_TYPE.TASKS, row(PARENT_ELSEWHERE, elsewhere, ids.elsewhereList));
};

const taskOf = (taskId) => db().store[SCHEMA_TYPE.TASKS].find((task) => String(task._id) === taskId);
const insert = (task) => socketEmitter.emit('insert', { type: 'insert', data: { ...db().seed(SCHEMA_TYPE.TASKS, task) }, module: 'task', companyId: C1 });

const AGENT = { userId: PERSON, agentId: 'agent-1', agentName: 'Helper', depth: 0 };
/* What a request made with an agent's token, narrowed to one project, runs its handler inside. */
const asNarrowedAgent = (projectId, write) => requestContext.run({ id: 'req-1', uid: PERSON }, () => runNarrowed({ userId: PERSON, projectIds: [projectId] },
    () => runForAgentOf(PERSON, { chat: false }, () => actingAgent.runAs(AGENT, write))));

const connect = (uid) => new Promise((resolve, reject) => {
    const socket = connectClient(`${baseURL}/userid_${C1}_${uid}`, {
        transports: ['websocket'], auth: { token: jwt.sign({ uid, aud: C1 }, SECRET) }, query: { userRole: 3 }, reconnection: false, forceNew: true,
    });
    open.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
});

const joinList = (socket, projectId, sprintId) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 400);
    socket.emit('joinProjectSprintForTask', { projectId, sprintId, socketId: socket.id }, (answer) => {
        clearTimeout(timer);
        resolve(Boolean(answer && answer.joined));
    });
});

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
    process.env.JWT_SECRET = SECRET;
    const { initSocket } = require('../socket/socketinit');
    server = http.createServer();
    initSocket(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseURL = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
    await new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
});

beforeEach(() => {
    myCache.flushAll();
    forgetVerdicts();
    seed();
    computedRefresh.start({ debounceMs: DEBOUNCE_MS });
});

afterEach(async () => {
    await computedRefresh.flush();
    computedRefresh.stop();
    open.splice(0).forEach((socket) => socket.close());
});

describe('the work that follows a write made with a token held to one project', () => {
    const colleagueThenAgent = async ({ between = () => {} } = {}) => {
        insert(row(CHILD_ELSEWHERE, ids.elsewhere, ids.elsewhereList, PARENT_ELSEWHERE));
        await settle(DEBOUNCE_MS / 4);
        between();
        asNarrowedAgent(ids.inReach, () => insert(row(TASK_IN_REACH, ids.inReach, ids.inReachList)));
        await settle(DEBOUNCE_MS * 3);
        await computedRefresh.flush();
    };

    it('works out a task of another project that waited in the same batch', async () => {
        await colleagueThenAgent();
        expect(taskOf(PARENT_ELSEWHERE).customField[TENFOLD].fieldValue).toBe(10);
        expect(taskOf(TASK_IN_REACH).customField[TENFOLD].fieldValue).toBe(0);
    });

    it('is heard by its listeners under no project list, no agent and no request', async () => {
        const seen = [];
        const hear = (payload) => {
            if (!Object.keys(payload.updatedFields || {}).some((key) => key.startsWith('customField.'))) return;
            seen.push({ narrowedTo: narrowingFor(PERSON), agent: agentOf(PERSON), mark: actingAgent.current(), request: requestContext.get() });
        };
        socketEmitter.on('task:update', hear);
        await colleagueThenAgent();
        socketEmitter.off('task:update', hear);
        expect(seen.length).toBeGreaterThanOrEqual(2);
        seen.forEach((context) => expect(context).toEqual({ narrowedTo: null, agent: null, mark: null, request: null }));
    });

    it('reaches that person\'s own screen in the other project, and so does the next change there', async () => {
        const screen = await connect(PERSON);
        expect(await joinList(screen, ids.elsewhere, ids.elsewhereList)).toBe(true);
        const heard = [];
        screen.onAny((event, payload) => heard.push({ event, task: String(payload.fullDocument._id), fields: Object.keys(payload.updatedFields || {}) }));

        await colleagueThenAgent({ between: forgetVerdicts });
        await settle(150);
        expect(heard).toContainEqual({ event: 'taskUpdate', task: PARENT_ELSEWHERE, fields: [`customField.${TENFOLD}`] });

        heard.length = 0;
        socketEmitter.emit('update', { type: 'update', data: { ...taskOf(PARENT_ELSEWHERE), TaskName: 'Renamed' }, updatedFields: { TaskName: 'Renamed' }, module: 'task', companyId: C1 });
        await settle(150);
        expect(heard).toEqual([{ event: 'taskUpdate', task: PARENT_ELSEWHERE, fields: ['TaskName'] }]);
    });
});

describe('what a screen is sent', () => {
    it('is decided for the person looking at it, whatever request the change came from', async () => {
        const screen = await connect(PERSON);
        expect(await joinList(screen, ids.elsewhere, ids.elsewhereList)).toBe(true);
        const heard = [];
        screen.onAny((event, payload) => heard.push({ event, name: payload.fullDocument.TaskName }));
        const rename = (TaskName) => socketEmitter.emit('update', { type: 'update', data: { ...taskOf(PARENT_ELSEWHERE), TaskName }, updatedFields: { TaskName }, module: 'task', companyId: C1 });

        asNarrowedAgent(ids.inReach, () => rename('First'));
        await settle(100);
        rename('Second');
        await settle(100);
        expect(heard).toEqual([{ event: 'taskUpdate', name: 'First' }, { event: 'taskUpdate', name: 'Second' }]);
    });
});

const http = require('http');
const { Server } = require('socket.io');
const { io: connectClient } = require('socket.io-client');

jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async (uid) => uid !== 'outsider') }));
jest.mock('../Modules/AgentSessions/access', () => ({
    taskOf: jest.fn(async (companyId, taskId) => ({ _id: taskId, ProjectID: 'p1', sprintId: 's1' })),
    canOpenTask: jest.fn(async (companyId, uid) => uid !== 'hidden'),
}));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));

const { taskSocketHandler } = require('../socket/controller/taskSocket');
const relay = require('../socket/controller/agentSessionSocket');
const { emitSession } = require('../Modules/AgentSessions/events');
const access = require('../Modules/AgentSessions/access');

const CID = '6a0000000000000000000001';
const TASK = '6a00000000000000000000c3';
const OTHER_TASK = '6a00000000000000000000c4';

let server;
let ioServer;
let port;
const clients = [];

beforeAll(async () => {
    server = http.createServer();
    ioServer = new Server(server);
    const users = ioServer.of(/^\/userid_\w+$/);
    users.use((socket, next) => {
        socket.user = { uid: socket.handshake.auth.uid };
        next();
    });
    users.on('connection', (socket) => taskSocketHandler({ socket, namespace: socket.nsp }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
});

afterAll(async () => {
    clients.forEach((c) => c.close());
    await new Promise((resolve) => ioServer.close(resolve));
});

beforeEach(() => relay.resetDecisions());

const open = (uid) => new Promise((resolve, reject) => {
    const socket = connectClient(`http://127.0.0.1:${port}/userid_${CID}_${uid}`, { transports: ['websocket'], auth: { uid }, reconnection: false });
    clients.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
});

const watch = async (uid, taskId) => {
    const socket = await open(uid);
    const got = [];
    socket.on(relay.EVENT, (payload) => got.push({ payload, at: Date.now() }));
    socket.emit('joinTaskDetail', { taskId, socketId: socket.id });
    await new Promise((resolve) => setTimeout(resolve, 100));
    return got;
};

const session = (fields = {}) => ({
    _id: '6a00000000000000000000f1', companyId: CID, taskId: TASK, clientId: 'ahc_coder', clientName: 'Coder', delegatedBy: 'owner',
    state: 'active', createdAt: new Date(), activityCount: 1, activities: [{ type: 'thought', text: 'Reading the brief', at: new Date() }], ...fields,
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

describe('the agent session relay', () => {
    it('reaches the task room within ten seconds of an activity', async () => {
        const got = await watch('owner', TASK);
        const at = Date.now();
        emitSession(session());
        const deadline = Date.now() + 10000;
        while (!got.length && Date.now() < deadline) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(got).toHaveLength(1);
        expect(got[0].at - at).toBeLessThan(10000);
        expect(got[0].payload).toMatchObject({ taskId: TASK, state: 'active', activities: [{ type: 'thought', text: 'Reading the brief' }] });
    });

    it('reaches only the room of the session task', async () => {
        const here = await watch('owner', TASK);
        const elsewhere = await watch('owner', OTHER_TASK);
        emitSession(session());
        await settle();
        expect(here).toHaveLength(1);
        expect(elsewhere).toHaveLength(0);
    });

    it('skips a socket in the room whose user cannot open the task or is not in the workspace', async () => {
        const allowed = await watch('member', TASK);
        const hidden = await watch('hidden', TASK);
        const outsider = await watch('outsider', TASK);
        emitSession(session());
        await settle();
        expect(allowed).toHaveLength(1);
        expect(hidden).toHaveLength(0);
        expect(outsider).toHaveLength(0);
        expect(access.canOpenTask).toHaveBeenCalledWith(CID, 'hidden', expect.objectContaining({ _id: TASK }));
    });

    it('stops reaching a socket that left the room', async () => {
        const socket = await open('owner');
        const got = [];
        socket.on(relay.EVENT, (payload) => got.push(payload));
        socket.emit('joinTaskDetail', { taskId: TASK, socketId: socket.id });
        await settle();
        socket.emit('leaveTaskDetail', `taskDetail_${TASK}**${socket.id}`);
        await settle();
        emitSession(session());
        await settle();
        expect(got).toHaveLength(0);
    });
});

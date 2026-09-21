const { create } = require('./fixtures/fakeMongo');

const mockDbs = {};
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, ...rest) => {
        const db = mockDbs[String(companyId)];
        return db ? db.crud(companyId, ...rest) : Promise.resolve(null);
    },
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/settings/securityPermissions/controller', () => ({ fetchRules: jest.fn(async () => []) }));
jest.mock('../Config/jwt', () => ({ resolveAccessSession: jest.fn(async () => ({ ok: true })) }));

const http = require('http');
const jwt = require('jsonwebtoken');
const { io: connectClient } = require('socket.io-client');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');

const SECRET = 'socket-room-access-secret';
const C1 = '6f00000000000000000a0c01';
const C2 = '6f00000000000000000a0c02';
const OWNER = '6f00000000000000000a0011';
const ADMIN = '6f00000000000000000a0012';
const MEMBER = '6f00000000000000000a0013';
const OUTSIDER = '6f00000000000000000a0014';

let server;
let baseURL;
let ids;
const open = [];

const seedCompanies = () => {
    mockDbs[C1] = create();
    mockDbs[C2] = create();
    const c1 = mockDbs[C1];
    const c2 = mockDbs[C2];
    [[OWNER, 1], [ADMIN, 2], [MEMBER, 3], [OUTSIDER, 3]].forEach(([userId, roleType]) => {
        c1.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
    });
    c2.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });

    const privateProject = c1.seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'Private', isPrivateSpace: true, AssigneeUserId: [MEMBER] });
    const openSprint = c1.seed(SCHEMA_TYPE.SPRINTS, { projectId: String(privateProject._id), private: false, AssigneeUserId: [] });
    const closedSprint = c1.seed(SCHEMA_TYPE.SPRINTS, { projectId: String(privateProject._id), private: true, AssigneeUserId: [OWNER] });
    const task = c1.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Plan', ProjectID: String(privateProject._id), sprintId: String(openSprint._id), AssigneeUserId: [MEMBER] });
    const sprintTask = c1.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Sprint plan', ProjectID: String(privateProject._id), sprintId: String(closedSprint._id), AssigneeUserId: [OWNER] });

    const otherProject = c2.seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'Elsewhere', isPrivateSpace: false, AssigneeUserId: [] });
    const otherTask = c2.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Elsewhere', ProjectID: String(otherProject._id), sprintId: '', AssigneeUserId: [] });

    ids = {
        privateProject: String(privateProject._id),
        openSprint: String(openSprint._id),
        closedSprint: String(closedSprint._id),
        task: String(task._id),
        sprintTask: String(sprintTask._id),
        otherTask: String(otherTask._id),
        otherProject: String(otherProject._id),
    };
};

const tokenFor = (uid, aud = C1) => jwt.sign({ uid, aud }, SECRET);

const connect = ({ uid, companyId = C1, namespaceUser = uid, aud = companyId }) => new Promise((resolve, reject) => {
    const socket = connectClient(`${baseURL}/userid_${companyId}_${namespaceUser}`, {
        transports: ['websocket'],
        auth: { token: tokenFor(uid, aud) },
        query: { userRole: 3 },
        reconnection: false,
        forceNew: true,
    });
    open.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (error) => reject(error));
});

const roomsOf = (socket) => new Promise((resolve) => {
    socket.emit('getRoomList', socket.id, (rooms) => resolve(rooms.filter((room) => !room.startsWith('call_'))));
});

const settle = (socket, event, data) => new Promise((resolve) => {
    const timer = setTimeout(resolve, 400);
    socket.emit(event, data, () => {
        clearTimeout(timer);
        resolve();
    });
});

const join = async (socket, event, data) => {
    await settle(socket, event, data);
    return roomsOf(socket);
};

const received = (socket, event, trigger, waitMs = 300) => new Promise((resolve) => {
    const payloads = [];
    socket.on(event, (payload) => payloads.push(payload));
    trigger();
    setTimeout(() => resolve(payloads), waitMs);
});

beforeAll(async () => {
    process.env.JWT_SECRET = SECRET;
    const { initSocket } = require('../socket/socketinit');
    server = http.createServer();
    initSocket(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseURL = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
    myCache.flushAll();
    seedCompanies();
});

afterEach(() => {
    open.splice(0).forEach((socket) => socket.close());
});

describe('handshake identity', () => {
    it('accepts a namespace naming the token user and a company in the token', async () => {
        await expect(connect({ uid: MEMBER })).resolves.toBeTruthy();
    });

    it('refuses a namespace naming another user', async () => {
        await expect(connect({ uid: MEMBER, namespaceUser: OWNER })).rejects.toThrow(/Authentication error/);
    });

    it('refuses a namespace naming a company the token was not issued for', async () => {
        await expect(connect({ uid: MEMBER, companyId: C2, aud: C1 })).rejects.toThrow(/Authentication error/);
    });
});

describe('task detail rooms', () => {
    const taskRoom = (socket, taskId) => join(socket, 'joinTaskDetail', { taskId, socketId: socket.id });

    it('lets a member join a task in a project they are on', async () => {
        const socket = await connect({ uid: MEMBER });
        expect(await taskRoom(socket, ids.task)).toContain(`taskDetail_${ids.task}**${socket.id}`);
    });

    it('refuses a member who is not on the task project', async () => {
        const socket = await connect({ uid: OUTSIDER });
        const refusals = [];
        socket.on('joinRefused', (payload) => refusals.push(payload));
        expect(await taskRoom(socket, ids.task)).toEqual([]);
        expect(refusals).toEqual([{ event: 'joinTaskDetail' }]);
    });

    it('refuses a task in a private sprint the member is not on', async () => {
        const socket = await connect({ uid: MEMBER });
        expect(await taskRoom(socket, ids.sprintTask)).toEqual([]);
    });

    it('refuses a task that belongs to another company', async () => {
        const socket = await connect({ uid: MEMBER });
        expect(await taskRoom(socket, ids.otherTask)).toEqual([]);
    });

    it('lets owners and admins join any task in their company, private sprints included', async () => {
        for (const uid of [OWNER, ADMIN]) {
            const socket = await connect({ uid });
            const rooms = await taskRoom(socket, ids.sprintTask);
            expect(rooms).toContain(`taskDetail_${ids.sprintTask}**${socket.id}`);
        }
    });

    it('delivers updates to a member in the room and nothing to a refused socket', async () => {
        const member = await connect({ uid: MEMBER });
        const outsider = await connect({ uid: OUTSIDER });
        await taskRoom(member, ids.task);
        await taskRoom(outsider, ids.task);

        const update = () => socketEmitter.emit('update', {
            type: 'update',
            module: 'task',
            data: { _id: ids.task, ProjectID: ids.privateProject, sprintId: ids.openSprint, AssigneeUserId: [MEMBER] },
            updatedFields: { TaskName: 'Plan v2' },
        });
        const [forMember, forOutsider] = await Promise.all([
            received(member, 'taskDetail_taskUpdate', update),
            received(outsider, 'taskDetail_taskUpdate', () => {}),
        ]);
        expect(forMember).toHaveLength(1);
        expect(forOutsider).toEqual([]);
    });
});

describe('project sprint rooms', () => {
    const sprintRoom = (socket, projectId, sprintId, extra = {}) => join(socket, 'joinProjectSprintForTask', { projectId, sprintId, socketId: socket.id, ...extra });

    it('lets a member join a sprint board of their project', async () => {
        const socket = await connect({ uid: MEMBER });
        expect(await sprintRoom(socket, ids.privateProject, ids.openSprint))
            .toContain(`project_sprint_${ids.privateProject}_${ids.openSprint}**${socket.id}`);
    });

    it('refuses a member of another project', async () => {
        const socket = await connect({ uid: OUTSIDER });
        expect(await sprintRoom(socket, ids.privateProject, ids.openSprint)).toEqual([]);
    });

    it('refuses a private sprint the member is not on', async () => {
        const socket = await connect({ uid: MEMBER });
        expect(await sprintRoom(socket, ids.privateProject, ids.closedSprint)).toEqual([]);
    });

    it('refuses a board filtered to another user', async () => {
        const socket = await connect({ uid: MEMBER });
        expect(await sprintRoom(socket, ids.privateProject, ids.openSprint, { userId: OWNER })).toEqual([]);
    });
});

describe('comment rooms', () => {
    const commentRoom = (socket, roomName) => join(socket, 'joinCommentRoom', { roomName, socketId: socket.id });

    it('lets a member join the comments of their project and of a task in it', async () => {
        const socket = await connect({ uid: MEMBER });
        await commentRoom(socket, `comments_project_${ids.privateProject}**${socket.id}`);
        const rooms = await commentRoom(socket, `comments_${ids.privateProject}_${ids.openSprint}_${ids.task}**${socket.id}`);
        expect(rooms).toEqual(expect.arrayContaining([
            `comments_project_${ids.privateProject}**${socket.id}`,
            `comments_${ids.privateProject}_${ids.openSprint}_${ids.task}**${socket.id}`,
        ]));
    });

    it('refuses a member who is not on the project', async () => {
        const socket = await connect({ uid: OUTSIDER });
        expect(await commentRoom(socket, `comments_project_${ids.privateProject}**${socket.id}`)).toEqual([]);
    });

    it('refuses the comments of a task in a private sprint the member is not on', async () => {
        const socket = await connect({ uid: MEMBER });
        expect(await commentRoom(socket, `comments_${ids.privateProject}_${ids.closedSprint}_${ids.sprintTask}**${socket.id}`)).toEqual([]);
    });

    it('refuses a room name that does not end in the socket own id', async () => {
        const socket = await connect({ uid: MEMBER });
        expect(await join(socket, 'joinCommentRoom', { roomName: `comments_project_${ids.privateProject}**someone-else`, socketId: 'someone-else' })).toEqual([]);
    });
});

describe('user rooms', () => {
    it('lets a user join their own notification and reminder rooms', async () => {
        const socket = await connect({ uid: MEMBER });
        await settle(socket, 'joinUserIdNotification', { uid: MEMBER, socketId: socket.id });
        const rooms = await join(socket, 'joinGeneralReminder', { uid: MEMBER, socketId: socket.id });
        expect(rooms).toEqual(expect.arrayContaining([
            `userIdNotification_${MEMBER}**${socket.id}`,
            `generalReminder_${MEMBER}**${socket.id}`,
        ]));
    });

    it('refuses another user id', async () => {
        const socket = await connect({ uid: MEMBER });
        await settle(socket, 'joinUserIdNotification', { uid: OWNER, socketId: socket.id });
        await settle(socket, 'joinGeneralReminder', { uid: OWNER, socketId: socket.id });
        expect(await join(socket, 'joinChats', { projectId: ids.privateProject, userId: OWNER, socketId: socket.id })).toEqual([]);
    });

    it('delivers a notification count only to its own user', async () => {
        const member = await connect({ uid: MEMBER });
        const outsider = await connect({ uid: OUTSIDER });
        await join(member, 'joinUserIdNotification', { uid: MEMBER, socketId: member.id });
        await join(outsider, 'joinUserIdNotification', { uid: MEMBER, socketId: outsider.id });
        const update = () => socketEmitter.emit('update', { type: 'update', module: 'userIdNotification', data: { userId: MEMBER, count: 3 } });
        const [forMember, forOutsider] = await Promise.all([
            received(member, 'userIdNoticationUpdate', update),
            received(outsider, 'userIdNoticationUpdate', () => {}),
        ]);
        expect(forMember).toHaveLength(1);
        expect(forOutsider).toEqual([]);
    });
});

describe('company rooms', () => {
    const companyRoom = (socket, companyId) => join(socket, 'joinCompaniesRoom', { roomName: `selected_companies_${companyId}**${socket.id}`, socketId: socket.id });

    it('lets a member join their own company room', async () => {
        const socket = await connect({ uid: MEMBER });
        expect(await companyRoom(socket, C1)).toContain(`selected_companies_${C1}**${socket.id}`);
    });

    it('refuses another company room', async () => {
        const socket = await connect({ uid: MEMBER });
        expect(await companyRoom(socket, C2)).toEqual([]);
    });
});

describe('socket housekeeping', () => {
    it('does not list or close another socket', async () => {
        const member = await connect({ uid: MEMBER });
        const outsider = await connect({ uid: OUTSIDER });
        await join(member, 'joinTaskDetail', { taskId: ids.task, socketId: member.id });

        const seen = await new Promise((resolve) => outsider.emit('getRoomList', member.id, resolve));
        expect(seen).toEqual([]);

        outsider.emit('disconnectNameSpace', member.id);
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(member.connected).toBe(true);
        expect(outsider.connected).toBe(true);
    });
});

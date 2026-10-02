const { create } = require('./fixtures/fakeMongo');

const mockDbs = {};
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, ...rest) => {
        const db = mockDbs[String(companyId)];
        return db ? db.crud(companyId, ...rest) : Promise.resolve(null);
    },
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/settings/securityPermissions/controller', () => ({ fetchRules: jest.fn(async () => require('./fixtures/taskListRules').taskListRules()) }));
jest.mock('../Config/jwt', () => ({ resolveAccessSession: jest.fn(async () => ({ ok: true })) }));

const http = require('http');
const jwt = require('jsonwebtoken');
const { io: connectClient } = require('socket.io-client');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const { upsertRoom, removeRoom } = require('../socket/helper');
const { forgetVerdicts } = require('../socket/roomAccess');

const SECRET = 'socket-room-membership-secret';
const HOME = '6f00000000000000000b0c01';
const ELSEWHERE = '6f00000000000000000b0c02';
const OWNER = '6f00000000000000000b0011';
const ADMIN = '6f00000000000000000b0012';
const MEMBER = '6f00000000000000000b0013';
const OUTSIDER = '6f00000000000000000b0014';
const NEIGHBOUR = '6f00000000000000000b0021';
const NOBODY = '6f00000000000000000b00ff';
const NOTHING = '6f00000000000000000b0eee';

const TASK_EVENTS = ['taskInsert', 'taskUpdate', 'taskDetail_taskUpdate', 'chatTaskUpdate'];
const COMMENT_EVENTS = ['commentInsert', 'commentUpdate'];
const OWN_EVENTS = ['userIdNoticationUpdate', 'generalReminderUpdate'];
const PINGS = {
    goals: 'goalsChanged',
    folders: 'foldersChanged',
    customFields: 'customFieldsChanged',
    viewTemplates: 'viewTemplatesChanged',
    projectSnapshots: 'projectTemplatesChanged',
    agent: 'agentsChanged',
    pageShares: 'docSharesChanged',
};

let server;
let baseURL;
let home;
let elsewhere;
const open = [];

const seat = (db, userId, roleType) => db.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
const list = (db, project, extra = {}) => db.seed(SCHEMA_TYPE.SPRINTS, { projectId: String(project._id), private: false, AssigneeUserId: [], ...extra });
const task = (db, project, sprint, extra = {}) => db.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Plan', ProjectID: String(project._id), sprintId: String(sprint._id), AssigneeUserId: [], ...extra });

const seedHome = () => {
    const db = create();
    mockDbs[HOME] = db;
    [[OWNER, 1], [ADMIN, 2], [MEMBER, 3], [OUTSIDER, 3]].forEach(([userId, roleType]) => seat(db, userId, roleType));

    const project = db.seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'Team', isPrivateSpace: true, AssigneeUserId: [MEMBER] });
    const openList = list(db, project);
    const privateList = list(db, project, { private: true, AssigneeUserId: [OWNER] });
    const personal = db.seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'Mine', isPersonal: true, personalOwner: MEMBER, isPrivateSpace: true, AssigneeUserId: [MEMBER] });
    const personalList = list(db, personal);

    const directSpace = db.seed(SCHEMA_TYPE.MAIN_CHATS, { default: true });
    const directList = list(db, directSpace);
    const channelSpace = db.seed(SCHEMA_TYPE.MAIN_CHATS, { default: false });
    const channel = list(db, channelSpace);
    const privateChannel = list(db, channelSpace, { private: true, AssigneeUserId: [OWNER] });

    return {
        db,
        project,
        openList,
        privateList,
        personal,
        personalList,
        directSpace,
        directList,
        channelSpace,
        channel,
        privateChannel,
        openTask: task(db, project, openList, { AssigneeUserId: [MEMBER] }),
        privateTask: task(db, project, privateList, { AssigneeUserId: [OWNER] }),
        personalTask: task(db, personal, personalList, { AssigneeUserId: [MEMBER] }),
        conversation: task(db, directSpace, directList, { mainChat: true, AssigneeUserId: [OWNER, ADMIN] }),
    };
};

const seedElsewhere = () => {
    const db = create();
    mockDbs[ELSEWHERE] = db;
    seat(db, NEIGHBOUR, 1);
    const project = db.seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'Theirs', isPrivateSpace: false, AssigneeUserId: [] });
    const openList = list(db, project);
    const directSpace = db.seed(SCHEMA_TYPE.MAIN_CHATS, { default: true });
    const directList = list(db, directSpace);
    const channelSpace = db.seed(SCHEMA_TYPE.MAIN_CHATS, { default: false });
    const channel = list(db, channelSpace);
    return {
        db,
        project,
        openList,
        directSpace,
        directList,
        channelSpace,
        channel,
        openTask: task(db, project, openList),
        conversation: task(db, directSpace, directList, { mainChat: true, AssigneeUserId: [NEIGHBOUR, MEMBER] }),
    };
};

const forgetAccess = () => {
    myCache.flushAll();
    forgetVerdicts();
};

const connect = ({ uid, companyId = HOME }) => new Promise((resolve, reject) => {
    const socket = connectClient(`${baseURL}/userid_${companyId}_${uid}`, {
        transports: ['websocket'],
        auth: { token: jwt.sign({ uid, aud: companyId }, SECRET) },
        query: { userRole: 3 },
        reconnection: false,
        forceNew: true,
    });
    open.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (error) => reject(error));
});

const roomsOf = (socket) => new Promise((resolve) => {
    socket.emit('getRoomList', socket.id, (rooms) => resolve(rooms));
});

const idOf = (row) => String((row && row._id) || row);

/* Whether the socket ends up in the room it asked for. */
const admitted = async (socket, event, data, prefix) => {
    await new Promise((resolve) => {
        const timer = setTimeout(resolve, 400);
        socket.emit(event, { socketId: socket.id, ...data }, () => {
            clearTimeout(timer);
            resolve();
        });
    });
    return (await roomsOf(socket)).includes(`${prefix}**${socket.id}`);
};

const listRoom = (socket, project, sprint) => admitted(socket, 'joinProjectSprintForTask', { projectId: idOf(project), sprintId: idOf(sprint) }, `project_sprint_${idOf(project)}_${idOf(sprint)}`);
const taskRoom = (socket, row) => admitted(socket, 'joinTaskDetail', { taskId: idOf(row) }, `taskDetail_${idOf(row)}`);
const chatRoom = (socket, space, userId) => admitted(socket, 'joinChats', { projectId: idOf(space), userId }, `chat_${idOf(space)}_${userId}`);
const commentRoom = (socket, prefix) => admitted(socket, 'joinCommentRoom', { roomName: `${prefix}**${socket.id}` }, prefix);
const threadOf = (project, sprint, row) => `comments_${idOf(project)}_${idOf(sprint)}_${idOf(row)}`;
const projectThread = (project) => `comments_project_${idOf(project)}`;

const companyRoom = (socket, companyId) => admitted(socket, 'joinCompaniesRoom', { roomName: `selected_companies_${companyId}**${socket.id}` }, `selected_companies_${companyId}`);
const ownRooms = async (socket, uid) => (await admitted(socket, 'joinUserIdNotification', { uid }, `userIdNotification_${uid}`))
    && admitted(socket, 'joinGeneralReminder', { uid }, `generalReminder_${uid}`);

const received = (socket, event, trigger) => new Promise((resolve) => {
    const got = [];
    socket.on(event, (payload) => got.push(payload));
    trigger();
    setTimeout(() => {
        socket.off(event);
        resolve(got);
    }, 300);
});

const heard = async (sockets, events, trigger) => {
    const got = sockets.map(() => []);
    sockets.forEach((socket, index) => events.forEach((event) => socket.on(event, () => got[index].push(event))));
    trigger();
    await new Promise((resolve) => setTimeout(resolve, 300));
    sockets.forEach((socket) => events.forEach((event) => socket.off(event)));
    return got;
};

const taskChanged = (row, companyId = HOME) => socketEmitter.emit('update', { type: 'update', module: 'task', companyId, data: row, updatedFields: { TaskName: 'Plan v2' } });
const messagePosted = (companyId, { project, sprint, row }) => socketEmitter.emit('insert', {
    type: 'insert',
    module: 'comments',
    companyId,
    data: { _id: NOTHING, message: 'Hello', projectId: String(project._id), sprintId: String(sprint._id), taskId: row === 'default' ? row : String(row._id) },
});
const projectMessagePosted = (companyId, project) => socketEmitter.emit('insert', {
    type: 'insert', module: 'comments_project', companyId, data: { _id: NOTHING, message: 'Hello', projectId: String(project._id) },
});
const countChanged = (companyId, userId) => socketEmitter.emit('update', { type: 'update', module: 'userIdNotification', companyId, data: { userId, notification_counts: 3 } });
const reminderChanged = (companyId, userId) => socketEmitter.emit('update', { type: 'update', module: 'generalReminder', companyId, data: { _id: NOTHING, userId, title: 'Call back' } });
const companyChanged = (companyId) => socketEmitter.emit('update', { type: 'update', module: 'companies', data: { data: { _id: companyId, Cst_CompanyName: 'Renamed' } }, updatedFields: {} });
const pinged = (companyId, userId) => Object.keys(PINGS).forEach((module) => socketEmitter.emit('update', {
    type: 'update', module, companyId, data: { kind: 'proposal', userId },
}));
const typing = (socket, prefix) => socket.emit('commentTyping', { roomPrefix: prefix, typing: true });
const loseSeat = (db, userId) => {
    db.store[SCHEMA_TYPE.COMPANY_USERS].find((row) => row.userId === userId).isDelete = true;
    forgetAccess();
};
const boardChanged = (companyId, project, sprint) => socketEmitter.emit('update', {
    type: 'update', module: 'whiteboards', companyId, projectId: String(project._id), sprintId: String(sprint._id), boardId: NOTHING, revision: 2,
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
    await new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
});

beforeEach(() => {
    forgetAccess();
    home = seedHome();
    elsewhere = seedElsewhere();
});

afterEach(() => {
    open.splice(0).forEach((socket) => socket.close());
});

describe('list rooms', () => {
    it('reach the people on the project', async () => {
        const member = await connect({ uid: MEMBER });
        expect(await listRoom(member, home.project, home.openList)).toBe(true);
        const [events] = await heard([member], TASK_EVENTS, () => taskChanged(home.openTask));
        expect(events).toEqual(['taskUpdate']);
    });

    it('stay inside their own workspace', async () => {
        const member = await connect({ uid: MEMBER });
        const neighbour = await connect({ uid: NEIGHBOUR, companyId: ELSEWHERE });
        expect(await listRoom(member, elsewhere.project, elsewhere.openList)).toBe(false);
        expect(await listRoom(neighbour, elsewhere.project, elsewhere.openList)).toBe(true);
        expect(await listRoom(neighbour, home.project, home.openList)).toBe(false);

        const [forMember, forNeighbour] = await heard([member, neighbour], TASK_EVENTS, () => {
            taskChanged(elsewhere.openTask, ELSEWHERE);
            taskChanged(home.openTask);
        });
        expect(forMember).toEqual([]);
        expect(forNeighbour).toEqual(['taskUpdate']);
    });

    it('are closed to a person who is not on the project', async () => {
        const outsider = await connect({ uid: OUTSIDER });
        expect(await listRoom(outsider, home.project, home.openList)).toBe(false);
        const [events] = await heard([outsider], TASK_EVENTS, () => taskChanged(home.openTask));
        expect(events).toEqual([]);
    });

    it('are closed for a private list to a person who is not on it', async () => {
        const member = await connect({ uid: MEMBER });
        expect(await listRoom(member, home.project, home.privateList)).toBe(false);
        const [events] = await heard([member], TASK_EVENTS, () => taskChanged(home.privateTask));
        expect(events).toEqual([]);
    });

    it('are closed when no project or list stands behind the ids', async () => {
        const member = await connect({ uid: MEMBER });
        expect(await listRoom(member, NOTHING, NOBODY)).toBe(false);
        expect(await listRoom(member, home.project, NOTHING)).toBe(false);
        expect(await listRoom(member, home.project, home.personalList)).toBe(false);
        const [events] = await heard([member], TASK_EVENTS, () => {
            taskChanged({ _id: NOBODY, ProjectID: NOTHING, sprintId: NOBODY, AssigneeUserId: [] });
            taskChanged({ _id: NOBODY, ProjectID: String(home.project._id), sprintId: NOTHING, AssigneeUserId: [] });
        });
        expect(events).toEqual([]);
    });

    it('keep a personal list to its owner', async () => {
        for (const uid of [OWNER, ADMIN, OUTSIDER]) {
            const socket = await connect({ uid });
            expect(await listRoom(socket, home.personal, home.personalList)).toBe(false);
        }
        const member = await connect({ uid: MEMBER });
        expect(await listRoom(member, home.personal, home.personalList)).toBe(true);
        const heardBy = await heard(open, TASK_EVENTS, () => taskChanged(home.personalTask));
        expect(heardBy).toEqual([[], [], [], ['taskUpdate']]);
    });

    it('open every list of the workspace to its owners and admins', async () => {
        const owner = await connect({ uid: OWNER });
        const admin = await connect({ uid: ADMIN });
        expect(await listRoom(owner, home.project, home.privateList)).toBe(true);
        expect(await listRoom(admin, home.project, home.privateList)).toBe(true);
        expect(await listRoom(owner, elsewhere.project, elsewhere.openList)).toBe(false);
        const heardBy = await heard([owner, admin], TASK_EVENTS, () => {
            taskChanged(home.privateTask);
            taskChanged(elsewhere.openTask, ELSEWHERE);
        });
        expect(heardBy).toEqual([['taskUpdate'], ['taskUpdate']]);
    });

    it('carry a change made in their own workspace, and one that names no workspace reaches nobody', async () => {
        const member = await connect({ uid: MEMBER });
        await listRoom(member, home.project, home.openList);
        await taskRoom(member, home.openTask);
        const [events] = await heard([member], TASK_EVENTS, () => {
            taskChanged(home.openTask, ELSEWHERE);
            taskChanged(home.openTask, null);
            taskChanged(home.openTask, '');
        });
        expect(events).toEqual([]);
        const [own] = await heard([member], TASK_EVENTS, () => taskChanged(home.openTask, HOME));
        expect(own).toEqual(['taskUpdate', 'taskDetail_taskUpdate']);
    });

    it('carry the board ping only while the list can be opened', async () => {
        const member = await connect({ uid: MEMBER });
        await listRoom(member, home.project, home.openList);
        const pinged = async (companyId) => (await heard([member], ['whiteboardChanged'], () => boardChanged(companyId, home.project, home.openList)))[0];
        expect(await pinged(ELSEWHERE)).toEqual([]);
        expect(await pinged(HOME)).toEqual(['whiteboardChanged']);

        Object.assign(home.openList, { private: true, AssigneeUserId: [OWNER] });
        forgetAccess();
        expect(await pinged(HOME)).toEqual([]);
    });

    it('do not carry a chat space', async () => {
        const member = await connect({ uid: MEMBER });
        expect(await listRoom(member, home.directSpace, home.directList)).toBe(false);
        expect(await listRoom(member, home.channelSpace, home.channel)).toBe(false);
        const [events] = await heard([member], TASK_EVENTS, () => taskChanged(home.conversation));
        expect(events).toEqual([]);
    });
});

describe('task rooms', () => {
    it('open a conversation to the people in it', async () => {
        const member = await connect({ uid: MEMBER });
        const owner = await connect({ uid: OWNER });
        expect(await taskRoom(member, home.conversation)).toBe(false);
        expect(await taskRoom(member, elsewhere.conversation)).toBe(false);
        expect(await taskRoom(member, elsewhere.openTask)).toBe(false);
        expect(await taskRoom(owner, home.conversation)).toBe(true);
        const heardBy = await heard([member, owner], TASK_EVENTS, () => {
            taskChanged(home.conversation);
            taskChanged(elsewhere.conversation, ELSEWHERE);
            taskChanged(elsewhere.openTask, ELSEWHERE);
        });
        expect(heardBy).toEqual([[], ['taskDetail_taskUpdate']]);
    });
});

describe('chat rooms', () => {
    it('send a conversation to the people in it', async () => {
        const member = await connect({ uid: MEMBER });
        const owner = await connect({ uid: OWNER });
        expect(await chatRoom(owner, home.directSpace, OWNER)).toBe(true);
        expect(await chatRoom(member, home.directSpace, MEMBER)).toBe(true);
        expect(await chatRoom(member, home.directSpace, OWNER)).toBe(false);
        const heardBy = await heard([member, owner], TASK_EVENTS, () => taskChanged(home.conversation));
        expect(heardBy).toEqual([[], ['chatTaskUpdate']]);
    });

    it('stay inside their own workspace', async () => {
        const member = await connect({ uid: MEMBER });
        expect(await chatRoom(member, elsewhere.directSpace, MEMBER)).toBe(false);
        expect(await chatRoom(member, NOTHING, MEMBER)).toBe(false);
        const [events] = await heard([member], TASK_EVENTS, () => taskChanged(elsewhere.conversation, ELSEWHERE));
        expect(events).toEqual([]);
    });
});

describe('comment rooms', () => {
    it('open a conversation thread to the people in it', async () => {
        const member = await connect({ uid: MEMBER });
        const owner = await connect({ uid: OWNER });
        const thread = threadOf(home.directSpace, home.directList, home.conversation);
        expect(await commentRoom(member, thread)).toBe(false);
        expect(await commentRoom(member, threadOf(home.directSpace, home.directList, 'default'))).toBe(false);
        expect(await commentRoom(member, projectThread(home.directSpace))).toBe(false);
        expect(await commentRoom(owner, thread)).toBe(true);
        const heardBy = await heard([member, owner], COMMENT_EVENTS, () => messagePosted(HOME, { project: home.directSpace, sprint: home.directList, row: home.conversation }));
        expect(heardBy).toEqual([[], ['commentInsert']]);
    });

    it('open a channel to the people who can see it', async () => {
        const member = await connect({ uid: MEMBER });
        const owner = await connect({ uid: OWNER });
        expect(await commentRoom(member, threadOf(home.channelSpace, home.channel, 'default'))).toBe(true);
        expect(await commentRoom(member, threadOf(home.channelSpace, home.privateChannel, 'default'))).toBe(false);
        expect(await commentRoom(member, threadOf(home.channelSpace, NOTHING, 'default'))).toBe(false);
        expect(await commentRoom(owner, threadOf(home.channelSpace, home.privateChannel, 'default'))).toBe(true);
        const heardBy = await heard([member, owner], COMMENT_EVENTS, () => {
            messagePosted(HOME, { project: home.channelSpace, sprint: home.channel, row: 'default' });
            messagePosted(HOME, { project: home.channelSpace, sprint: home.privateChannel, row: 'default' });
        });
        expect(heardBy).toEqual([['commentInsert'], ['commentInsert']]);
    });

    it('open the comments of a project and of a task to the people on the project', async () => {
        const member = await connect({ uid: MEMBER });
        const outsider = await connect({ uid: OUTSIDER });
        const thread = threadOf(home.project, home.openList, home.openTask);
        expect(await commentRoom(member, projectThread(home.project))).toBe(true);
        expect(await commentRoom(member, thread)).toBe(true);
        expect(await commentRoom(outsider, projectThread(home.project))).toBe(false);
        expect(await commentRoom(outsider, thread)).toBe(false);
        expect(await commentRoom(member, threadOf(home.personal, home.personalList, home.openTask))).toBe(false);
        const heardBy = await heard([member, outsider], COMMENT_EVENTS, () => {
            projectMessagePosted(HOME, home.project);
            messagePosted(HOME, { project: home.project, sprint: home.openList, row: home.openTask });
        });
        expect(heardBy).toEqual([['commentInsert', 'commentInsert'], []]);
    });

    it('stay inside their own workspace', async () => {
        const member = await connect({ uid: MEMBER });
        expect(await commentRoom(member, projectThread(elsewhere.project))).toBe(false);
        expect(await commentRoom(member, threadOf(elsewhere.project, elsewhere.openList, elsewhere.openTask))).toBe(false);
        expect(await commentRoom(member, threadOf(elsewhere.project, elsewhere.openList, 'default'))).toBe(false);
        expect(await commentRoom(member, threadOf(elsewhere.channelSpace, elsewhere.channel, 'default'))).toBe(false);
        expect(await commentRoom(member, threadOf(elsewhere.directSpace, elsewhere.directList, elsewhere.conversation))).toBe(false);
        expect(await commentRoom(member, projectThread(NOTHING))).toBe(false);
        expect(await commentRoom(member, threadOf(NOTHING, NOBODY, NOBODY))).toBe(false);
        const [events] = await heard([member], COMMENT_EVENTS, () => {
            projectMessagePosted(ELSEWHERE, elsewhere.project);
            messagePosted(ELSEWHERE, { project: elsewhere.project, sprint: elsewhere.openList, row: elsewhere.openTask });
            messagePosted(ELSEWHERE, { project: elsewhere.channelSpace, sprint: elsewhere.channel, row: 'default' });
            messagePosted(ELSEWHERE, { project: elsewhere.directSpace, sprint: elsewhere.directList, row: elsewhere.conversation });
        });
        expect(events).toEqual([]);
    });
});

describe('typing in a thread', () => {
    it('is told under the name of the person whose socket sent it', async () => {
        const owner = await connect({ uid: OWNER });
        const admin = await connect({ uid: ADMIN });
        const thread = threadOf(home.directSpace, home.directList, home.conversation);
        expect(await commentRoom(owner, thread)).toBe(true);
        expect(await commentRoom(admin, thread)).toBe(true);
        const signals = await received(owner, 'commentTyping', () => admin.emit('commentTyping', { roomPrefix: thread, userId: MEMBER, typing: true }));
        expect(signals).toEqual([{ roomPrefix: thread, userId: ADMIN, typing: true }]);
    });

    it('reaches the other people in the thread while they can still open it', async () => {
        const member = await connect({ uid: MEMBER });
        const owner = await connect({ uid: OWNER });
        const thread = threadOf(home.project, home.openList, home.openTask);
        expect(await commentRoom(member, thread)).toBe(true);
        expect(await commentRoom(owner, thread)).toBe(true);
        expect(await received(member, 'commentTyping', () => typing(owner, thread))).toEqual([{ roomPrefix: thread, userId: OWNER, typing: true }]);
        expect(await received(owner, 'commentTyping', () => typing(owner, thread))).toEqual([]);

        home.project.AssigneeUserId = [];
        forgetAccess();
        expect(await received(member, 'commentTyping', () => typing(owner, thread))).toEqual([]);
    });

    it('is not carried by a room that is not a thread', async () => {
        const member = await connect({ uid: MEMBER });
        const owner = await connect({ uid: OWNER });
        const prefix = `project_sprint_${idOf(home.project)}_${idOf(home.openList)}`;
        expect(await listRoom(member, home.project, home.openList)).toBe(true);
        expect(await listRoom(owner, home.project, home.openList)).toBe(true);
        expect(await received(member, 'commentTyping', () => typing(owner, prefix))).toEqual([]);
    });
});

describe('a person\'s own rooms', () => {
    it('carry the counts and reminders of the workspace the socket is in', async () => {
        seat(elsewhere.db, MEMBER, 3);
        const here = await connect({ uid: MEMBER });
        const there = await connect({ uid: MEMBER, companyId: ELSEWHERE });
        expect(await ownRooms(here, MEMBER)).toBe(true);
        expect(await ownRooms(there, MEMBER)).toBe(true);

        expect(await heard([here, there], OWN_EVENTS, () => countChanged(HOME, MEMBER))).toEqual([['userIdNoticationUpdate'], []]);
        expect(await heard([here, there], OWN_EVENTS, () => reminderChanged(ELSEWHERE, MEMBER))).toEqual([[], ['generalReminderUpdate']]);
        expect(await heard([here, there], OWN_EVENTS, () => {
            countChanged(undefined, MEMBER);
            reminderChanged(undefined, MEMBER);
        })).toEqual([[], []]);
    });
});

describe('a room that is already open', () => {
    const stillHears = async (socket, row) => (await heard([socket], TASK_EVENTS, () => taskChanged(row)))[0].length > 0;

    it('goes quiet when the person leaves the project', async () => {
        const member = await connect({ uid: MEMBER });
        await listRoom(member, home.project, home.openList);
        await taskRoom(member, home.openTask);
        expect(await stillHears(member, home.openTask)).toBe(true);

        home.project.AssigneeUserId = [];
        forgetAccess();
        expect(await stillHears(member, home.openTask)).toBe(false);
    });

    it('goes quiet when the list turns private', async () => {
        const member = await connect({ uid: MEMBER });
        await listRoom(member, home.project, home.openList);
        expect(await stillHears(member, home.openTask)).toBe(true);

        Object.assign(home.openList, { private: true, AssigneeUserId: [OWNER] });
        forgetAccess();
        expect(await stillHears(member, home.openTask)).toBe(false);
    });

    it('goes quiet when the person loses their seat', async () => {
        const owner = await connect({ uid: OWNER });
        await chatRoom(owner, home.directSpace, OWNER);
        await commentRoom(owner, threadOf(home.directSpace, home.directList, home.conversation));
        expect(await stillHears(owner, home.conversation)).toBe(true);

        home.db.store[SCHEMA_TYPE.COMPANY_USERS].find((row) => row.userId === OWNER).isDelete = true;
        forgetAccess();
        expect(await stillHears(owner, home.conversation)).toBe(false);
        const [events] = await heard([owner], COMMENT_EVENTS, () => messagePosted(HOME, { project: home.directSpace, sprint: home.directList, row: home.conversation }));
        expect(events).toEqual([]);
    });

    it('stops carrying the workspace record when the person loses their seat', async () => {
        const owner = await connect({ uid: OWNER });
        expect(await companyRoom(owner, HOME)).toBe(true);
        const told = async () => (await heard([owner], ['companiesUpdate'], () => companyChanged(HOME)))[0];
        expect(await told()).toEqual(['companiesUpdate']);

        loseSeat(home.db, OWNER);
        expect(await told()).toEqual([]);
    });

    it('carries the workspace\'s change pings to the people seated in it, and stops when the seat is lost', async () => {
        const owner = await connect({ uid: OWNER });
        const member = await connect({ uid: MEMBER });
        expect(await companyRoom(owner, HOME)).toBe(true);
        expect(await companyRoom(member, HOME)).toBe(true);
        const told = () => heard([owner, member], Object.values(PINGS), () => pinged(HOME, OWNER));
        expect(await told()).toEqual([Object.values(PINGS), Object.values(PINGS).filter((event) => event !== PINGS.pageShares)]);
        expect(await heard([owner, member], Object.values(PINGS), () => {
            pinged(ELSEWHERE, OWNER);
            pinged(undefined, OWNER);
        })).toEqual([[], []]);

        loseSeat(home.db, OWNER);
        expect(await told()).toEqual([[], Object.values(PINGS).filter((event) => event !== PINGS.pageShares)]);
    });

    it('stops carrying a person\'s own counts and reminders when they lose their seat', async () => {
        const member = await connect({ uid: MEMBER });
        expect(await ownRooms(member, MEMBER)).toBe(true);
        const told = async () => (await heard([member], OWN_EVENTS, () => {
            countChanged(HOME, MEMBER);
            reminderChanged(HOME, MEMBER);
        }))[0];
        expect(await told()).toEqual(OWN_EVENTS);

        loseSeat(home.db, MEMBER);
        expect(await told()).toEqual([]);
    });
});

describe('what a room is sent', () => {
    const registered = [];
    const sent = [];
    const register = (identity, prefix) => {
        const socket = { id: `held-${registered.length}`, rooms: new Set(), identity };
        const roomName = `${prefix}**${socket.id}`;
        socket.rooms.add(roomName);
        upsertRoom({ roomName, socketId: socket.id, socket, namespace: { name: `/userid_${HOME}_${MEMBER}`, to: () => ({ emit: (event) => sent.push({ prefix, event }) }) } });
        registered.push(roomName);
    };
    const settled = () => new Promise((resolve) => setTimeout(resolve, 100));

    afterEach(() => {
        registered.splice(0).forEach(removeRoom);
        sent.length = 0;
    });

    it('is only what its socket can read in its own workspace', async () => {
        const identity = { companyId: HOME, uid: MEMBER };
        register(identity, `project_sprint_${elsewhere.project._id}_${elsewhere.openList._id}`);
        register(identity, `taskDetail_${elsewhere.openTask._id}`);
        register(identity, `chat_${home.directSpace._id}_${OWNER}`);
        register(identity, projectThread(elsewhere.project));
        register(identity, threadOf(elsewhere.project, elsewhere.openList, elsewhere.openTask));
        register(identity, `selected_companies_${ELSEWHERE}`);
        register(undefined, `project_sprint_${home.project._id}_${home.openList._id}`);
        register(identity, `project_sprint_${home.project._id}_${home.openList._id}`);

        taskChanged(elsewhere.openTask, ELSEWHERE);
        taskChanged(home.conversation);
        projectMessagePosted(ELSEWHERE, elsewhere.project);
        messagePosted(ELSEWHERE, { project: elsewhere.project, sprint: elsewhere.openList, row: elsewhere.openTask });
        socketEmitter.emit('update', { type: 'update', module: 'companies', data: { data: { _id: ELSEWHERE, Cst_CompanyName: 'Theirs' } }, updatedFields: {} });
        taskChanged(home.openTask);
        await settled();

        expect(sent).toEqual([{ prefix: `project_sprint_${home.project._id}_${home.openList._id}`, event: 'taskUpdate' }]);
    });
});

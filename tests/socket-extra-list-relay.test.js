/* Task 046 M3, slice L5: a change to a task reaches the people looking at a list the task was
   added to. A room of that list is joined on the list alone, and the event carries the whole task,
   so each socket is judged on the task's home first. Real sockets over a fake database. */
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

const SECRET = 'socket-extra-list-relay-secret';
const C1 = '6f00000000000000000b0c01';
const OWNER = '6f00000000000000000b0011';
const ON_BOTH = '6f00000000000000000b0012';
const LIST_ONLY = '6f00000000000000000b0013';
const HOME_ONLY = '6f00000000000000000b0014';

let server;
let baseURL;
let ids;
const open = [];

const seed = () => {
    mockDbs[C1] = create();
    const db = mockDbs[C1];
    [[OWNER, 1], [ON_BOTH, 3], [LIST_ONLY, 3], [HOME_ONLY, 3]].forEach(([userId, roleType]) => {
        db.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
    });
    const home = db.seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'Home', isPrivateSpace: true, AssigneeUserId: [ON_BOTH, HOME_ONLY] });
    const elsewhere = db.seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'Elsewhere', isPrivateSpace: true, AssigneeUserId: [ON_BOTH, LIST_ONLY] });
    const list = (project, extra = {}) => String(db.seed(SCHEMA_TYPE.SPRINTS, { projectId: String(project._id), private: false, AssigneeUserId: [], ...extra })._id);
    ids = {
        home: String(home._id),
        elsewhere: String(elsewhere._id),
        homeList: list(home),
        secondList: list(home),
        privateList: list(home, { private: true, AssigneeUserId: [HOME_ONLY] }),
        thereList: list(elsewhere),
        task: '6f00000000000000000b0701',
        privateTask: '6f00000000000000000b0702',
    };
};

const entry = (projectId, sprintId) => ({ projectId, sprintId });
const taskRow = (extra = {}) => ({
    _id: ids.task, TaskName: 'Write the brief', ProjectID: ids.home, sprintId: ids.homeList, AssigneeUserId: [ON_BOTH],
    extraLists: [entry(ids.home, ids.secondList), entry(ids.elsewhere, ids.thereList)], ...extra,
});
const change = (data, extra = {}) => socketEmitter.emit('update', { type: 'update', module: 'task', data, updatedFields: { TaskName: data.TaskName }, ...extra });

const connect = (uid) => new Promise((resolve, reject) => {
    const socket = connectClient(`${baseURL}/userid_${C1}_${uid}`, {
        transports: ['websocket'], auth: { token: jwt.sign({ uid, aud: C1 }, SECRET) }, query: { userRole: 3 }, reconnection: false, forceNew: true,
    });
    open.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
});

const joinList = (socket, projectId, sprintId, extra = {}) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 400);
    socket.emit('joinProjectSprintForTask', { projectId, sprintId, socketId: socket.id, ...extra }, (answer) => {
        clearTimeout(timer);
        resolve(Boolean(answer && answer.joined));
    });
});

/* Everything a socket hears, on any event, while `trigger` runs and for a moment after. */
const heard = (sockets, trigger, waitMs = 300) => new Promise((resolve) => {
    const all = sockets.map(() => []);
    sockets.forEach((socket, at) => socket.onAny((event, payload) => all[at].push({ event, payload })));
    trigger();
    setTimeout(() => {
        sockets.forEach((socket) => socket.offAny());
        resolve(all);
    }, waitMs);
});

const watching = async (uid, projectId, sprintId, extra) => {
    const socket = await connect(uid);
    expect(await joinList(socket, projectId, sprintId, extra)).toBe(true);
    return socket;
};

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
    seed();
});

afterEach(() => {
    open.splice(0).forEach((socket) => socket.close());
});

describe('a change to a task that is in another list', () => {
    it('reaches a person looking at that list who can read the task, with the whole task', async () => {
        const onBoth = await watching(ON_BOTH, ids.elsewhere, ids.thereList);

        const [events] = await heard([onBoth], () => change(taskRow({ TaskName: 'Write the brief, v2' })));

        expect(events.map((item) => item.event)).toEqual(['taskUpdate']);
        expect(events[0].payload.fullDocument).toMatchObject({ _id: ids.task, TaskName: 'Write the brief, v2', sprintId: ids.homeList });
        expect(events[0].payload.updatedFields).toEqual({ TaskName: 'Write the brief, v2' });
    });

    it('sends nothing at all to a person on the list who cannot open the task\'s project', async () => {
        const listOnly = await watching(LIST_ONLY, ids.elsewhere, ids.thereList);
        const onBoth = await watching(ON_BOTH, ids.elsewhere, ids.thereList);

        const [forListOnly, forOnBoth] = await heard([listOnly, onBoth], () => change(taskRow()));

        expect(forOnBoth).toHaveLength(1);
        expect(forListOnly).toEqual([]);
    });

    it('sends nothing to a person who is not on the private list the task lives in, and reaches one who reads past it', async () => {
        const hidden = taskRow({ _id: ids.privateTask, sprintId: ids.privateList, extraLists: [entry(ids.home, ids.secondList)] });
        const onBoth = await watching(ON_BOTH, ids.home, ids.secondList);
        const homeOnly = await watching(HOME_ONLY, ids.home, ids.secondList);
        const owner = await watching(OWNER, ids.home, ids.secondList);

        const [forOnBoth, forHomeOnly, forOwner] = await heard([onBoth, homeOnly, owner], () => change(hidden));

        expect(forOnBoth).toEqual([]);
        expect(forHomeOnly.map((item) => item.event)).toEqual(['taskUpdate']);
        expect(forOwner.map((item) => item.event)).toEqual(['taskUpdate']);
    });

    it('reaches the list it was taken out of, so the row can go from it', async () => {
        const onBoth = await watching(ON_BOTH, ids.elsewhere, ids.thereList);
        const listOnly = await watching(LIST_ONLY, ids.elsewhere, ids.thereList);
        const left = taskRow({ extraLists: [entry(ids.home, ids.secondList)] });

        const [forOnBoth, forListOnly] = await heard([onBoth, listOnly], () => change(left, { updatedFields: { extraLists: left.extraLists }, leftLists: [entry(ids.elsewhere, ids.thereList)] }));

        expect(forOnBoth).toHaveLength(1);
        expect(forOnBoth[0].payload.updatedFields.extraLists).toEqual([entry(ids.home, ids.secondList)]);
        expect(forOnBoth[0].payload).not.toHaveProperty('leftLists');
        expect(forListOnly).toEqual([]);
    });

    it('is heard once in the list the task lives in, and not in a list it is not in', async () => {
        const atHome = await watching(ON_BOTH, ids.home, ids.homeList);
        const unrelated = await watching(OWNER, ids.home, ids.privateList);

        const [forHome, forUnrelated] = await heard([atHome, unrelated], () => change(taskRow()));

        expect(forHome.map((item) => item.event)).toEqual(['taskUpdate']);
        expect(forUnrelated).toEqual([]);
    });

    it('keeps two changes in the order they were made', async () => {
        const onBoth = await watching(ON_BOTH, ids.elsewhere, ids.thereList);

        const [events] = await heard([onBoth], () => {
            change(taskRow({ TaskName: 'first' }));
            change(taskRow({ TaskName: 'second' }));
        });

        expect(events.map((item) => item.payload.fullDocument.TaskName)).toEqual(['first', 'second']);
    });

    it('goes to a person who filtered the list to their own tasks only when the task is theirs', async () => {
        const mine = await watching(ON_BOTH, ids.elsewhere, ids.thereList, { userId: ON_BOTH });

        const [events] = await heard([mine], () => {
            change(taskRow({ TaskName: 'assigned to someone else', AssigneeUserId: [HOME_ONLY] }));
            change(taskRow({ TaskName: 'assigned to me' }));
        });

        expect(events.map((item) => item.payload.fullDocument.TaskName)).toEqual(['assigned to me']);
    });

    it('never passes on a conversation row or a row with no project behind it', async () => {
        const onBoth = await watching(ON_BOTH, ids.elsewhere, ids.thereList);

        const [events] = await heard([onBoth], () => {
            change(taskRow({ mainChat: true }));
            change(taskRow({ ProjectID: '6f00000000000000000b0fff' }));
        });

        expect(events).toEqual([]);
    });
});

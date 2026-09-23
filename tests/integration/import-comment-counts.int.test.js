const { io } = require('socket.io-client');
const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { listSprints, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* Follow-up 118. Comments carried in by a Trello import count as unread for the task's people, as a comment
 * written in the app does, and the change reaches them over the socket. */

const state = readState();

jest.setTimeout(60000);

let client;
let db;
let owner;
let member;
let target;
let socket;

const connect = (session) => new Promise((resolve, reject) => {
    const s = io(`${state.baseURL}/userid_${state.companyId}_${session.userId}`, {
        transports: ['websocket'], auth: { token: session.accessToken }, query: { userRole: 3 }, reconnection: false, timeout: 10000,
    });
    s.once('connect', () => resolve(s));
    s.once('connect_error', (error) => { s.close(); reject(error); });
});

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    db = client.db(String(state.companyId));
    owner = await loginAs('owner');
    member = await loginAs('member');
    const [sprint] = await listSprints(owner.api, state.projects.shared._id);
    target = { projectId: String(state.projects.shared._id), sprintId: String(sprint._id || sprint.id) };
    socket = await connect(member);
    await new Promise((resolve) => socket.emit('joinUserIdNotification', { uid: member.userId }, resolve));
});

afterAll(async () => {
    if (socket) socket.close();
    if (client) await client.close();
});

it('counts imported comments as unread for the task\'s member and tells them over the socket', async () => {
    const name = `[QA import comments] ${uniqueSuffix()}`;
    const importing = owner.api.post('/api/v2/imports/trello', {
        projectId: target.projectId,
        sprintId: target.sprintId,
        board: {
            lists: [{ id: 'l1', name: 'To Do', closed: false }],
            members: [{ id: 'm1', email: String(state.users.member.email).toLowerCase() }],
            cards: [{ id: 'c1', name, idList: 'l1', closed: false, idMembers: ['m1'] }],
            actions: [
                { type: 'commentCard', data: { card: { id: 'c1' }, text: 'first' }, memberCreator: { fullName: 'Trello Tom' } },
                { type: 'commentCard', data: { card: { id: 'c1' }, text: 'second' }, memberCreator: { fullName: 'Trello Tom' } },
            ],
        },
    });
    const pushed = new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 10000);
        socket.on('userIdNoticationUpdate', (payload) => {
            const doc = payload && payload.fullDocument;
            const hit = doc && Object.keys(doc).find((key) => key.startsWith(`task_${target.projectId}_${target.sprintId}_`) && doc[key] === 2);
            if (hit) { clearTimeout(timer); resolve(hit); }
        });
    });

    const res = await importing;
    expect(res.body.status).toBe(true);
    const task = await db.collection('tasks').findOne({ TaskName: name });
    expect(task).toBeTruthy();
    const field = `task_${target.projectId}_${target.sprintId}_${String(task._id)}_comments`;

    expect(await db.collection('comments').countDocuments({ taskId: task._id })).toBe(2);
    const counters = db.collection('userId');
    expect((await counters.findOne({ userId: String(member.userId) }) || {})[field]).toBe(2);
    expect((await counters.findOne({ userId: String(owner.userId) }) || {})[field]).toBeUndefined();
    expect(await pushed).toBe(field);
});

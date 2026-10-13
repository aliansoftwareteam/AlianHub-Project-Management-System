process.env.STORAGE_TYPE = 'server';
jest.setTimeout(30000);
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/AI/aiMention', () => ({ acceptFromComment: jest.fn(async () => null) }));
jest.mock('../Modules/Agents/chatAgents', () => ({ fromChatMessage: jest.fn(async () => null) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const { upsertRoom, removeRoom } = require('../socket/helper');
const { forgetVerdicts } = require('../socket/roomAccess');
require('../socket/controller/commentSocket');
const comments = require('../Modules/Comments/controller');
const reactions = require('../Modules/Reactions/controller');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, L_OPEN, L_SECRET, T_OPEN, T_SECRET, settle } = world;
const { seed, rows } = world.create(mockDb);

const EVERYONE = [OWNER, ADMIN, INSIDER, OUTSIDER, GUEST];
const PROJECT_ROOM = `comments_project_${P_OPEN}`;
const threadRoom = (sprintId, taskId) => `comments_${P_OPEN}_${sprintId}_${taskId}`;
const SHAPES = {
    'the shape of a task comment': (thread, extra) => ({ objId: thread, ...extra }),
    'the shape of a project comment': (thread, extra) => ({ ...thread, ...extra }),
};

let heard;
const joined = [];
/* A person sitting in a room: what reaches them is kept under their id and the room. */
const sit = (uid, prefix) => {
    const roomName = `${prefix}**socket-${joined.length}`;
    const socket = { id: `socket-${joined.length}`, identity: { companyId: CID, uid }, rooms: new Set([roomName]), disconnected: false };
    const namespace = { to: () => ({ emit: (event, payload) => heard.push([uid, prefix, String(payload.fullDocument._id)]) }) };
    upsertRoom({ roomName, socketId: socket.id, namespace, socket });
    joined.push(roomName);
};

const answered = (handler, req) => new Promise((resolve) => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (answer) => { resolve({ code: res.statusCode, body: answer }); return res; };
    res.send = res.json;
    handler({ headers: { companyid: CID }, query: {}, params: {}, body: {}, method: 'POST', originalUrl: '/', ...req }, res);
}).then(async (answer) => { await settle(); await settle(); return answer; });

beforeEach(() => {
    jest.clearAllMocks();
    seed();
    forgetVerdicts();
    heard = [];
    EVERYONE.forEach((uid) => sit(uid, PROJECT_ROOM));
    [OWNER, ADMIN, INSIDER].forEach((uid) => sit(uid, threadRoom(L_SECRET, T_SECRET)));
    EVERYONE.forEach((uid) => sit(uid, threadRoom(L_OPEN, T_OPEN)));
});
afterEach(() => { joined.splice(0).forEach(removeRoom); });

const inRoom = (prefix, commentId) => heard.filter(([, room, id]) => room === prefix && id === commentId).map(([uid]) => uid).sort();
const message = (extra = {}) => ({ type: 'text', message: 'Hello', userId: INSIDER, project: false, ...extra });

describe('a comment is told live in the room of the thread it is stored in', () => {
    it.each(Object.keys(SHAPES))('when it is written to a task of a private list in %s', async (shape) => {
        const { body } = await answered(comments.save, { uid: INSIDER, body: { data: SHAPES[shape]({ projectId: P_OPEN, sprintId: L_SECRET, taskId: T_SECRET }, message()) } });
        const id = String(body.data._id);

        expect(String(rows(SCHEMA_TYPE.COMMENTS).find((row) => String(row._id) === id).taskId)).toBe(T_SECRET);
        expect(inRoom(PROJECT_ROOM, id)).toEqual([]);
        expect(inRoom(threadRoom(L_SECRET, T_SECRET), id)).toEqual([OWNER, ADMIN, INSIDER].sort());
    });

    it.each([[true], [false]])('when it is edited or reacted to, whatever the request says of it (project comment: %s)', async (isProjectComment) => {
        const { body } = await answered(comments.save, { uid: INSIDER, body: { data: SHAPES['the shape of a task comment']({ projectId: P_OPEN, sprintId: L_SECRET, taskId: T_SECRET }, message()) } });
        const id = String(body.data._id);
        heard = [];

        await answered(comments.update, { uid: INSIDER, body: { id, isProjectComment, data: { message: 'Hello again' } } });
        await answered(reactions.toggleReaction, { uid: INSIDER, body: { targetType: 'comment', targetId: id, emoji: '👍', isProjectComment } });

        expect(inRoom(PROJECT_ROOM, id)).toEqual([]);
        expect([...new Set(inRoom(threadRoom(L_SECRET, T_SECRET), id))]).toEqual([OWNER, ADMIN, INSIDER].sort());
    });

    it('and a comment on the project itself is still told to the people who can open the project', async () => {
        const { body } = await answered(comments.save, { uid: INSIDER, body: { data: { objId: { projectId: P_OPEN }, ...message({ project: true }) } } });
        const id = String(body.data._id);

        expect(inRoom(PROJECT_ROOM, id)).toEqual([...EVERYONE].sort());
        heard = [];
        await answered(comments.update, { uid: INSIDER, body: { id, isProjectComment: true, data: { message: 'Hello again' } } });
        expect(inRoom(PROJECT_ROOM, id)).toEqual([...EVERYONE].sort());
    });

    it('and a comment on an open task is still told to the people in that task', async () => {
        const { body } = await answered(comments.save, { uid: INSIDER, body: { data: { objId: { projectId: P_OPEN, sprintId: L_OPEN, taskId: T_OPEN }, ...message() } } });
        expect(inRoom(threadRoom(L_OPEN, T_OPEN), String(body.data._id))).toEqual([...EVERYONE].sort());
    });
});

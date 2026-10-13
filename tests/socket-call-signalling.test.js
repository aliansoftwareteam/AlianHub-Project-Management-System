const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { callSocketHandler, __internals } = require('../socket/controller/callSocket');
const { removeBySocket } = require('../socket/helper');

const C = '6f00000000000000000a0c01';
const CALLER = '6f00000000000000000a0011';
const CALLEE = '6f00000000000000000a0012';
const SPACE = '6f00000000000000000a0d01';

let sockets;
let sent;
let chat;

const namespace = { to: (roomName) => ({ emit: (event, payload) => sent.push({ roomName, event, payload }) }) };

const connect = (uid, id = `socket-${uid.slice(-2)}-${sockets.length}`) => {
    const handlers = {};
    const socket = {
        id,
        user: { uid, aud: C },
        identity: { companyId: C, uid },
        nsp: { name: `/userid_${C}_${uid}` },
        rooms: new Set(),
        join: (room) => socket.rooms.add(room),
        leave: (room) => socket.rooms.delete(room),
        on: (event, handler) => { handlers[event] = handler; },
        emit: jest.fn(),
        send: (event, payload) => handlers[event](payload),
    };
    sockets.push(socket);
    callSocketHandler({ socket, namespace });
    return socket;
};

const told = (socket, event) => socket.emit.mock.calls.filter(([name]) => name === event).map(([, payload]) => payload);
const rung = () => sent.filter(({ event }) => event === 'call:incoming');
const seat = (userId) => mockDb.store[SCHEMA_TYPE.COMPANY_USERS].find((row) => row.userId === userId);
const historyLines = () => mockDb.store[SCHEMA_TYPE.COMMENTS] || [];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    myCache.flushAll();
    sockets = [];
    sent = [];
    [CALLER, CALLEE].forEach((userId) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType: 3, status: 2, isDelete: false }));
    chat = mockDb.seed(SCHEMA_TYPE.TASKS, { _id: '6f00000000000000000a0e01', mainChat: true, AssigneeUserId: [CALLER, CALLEE], ProjectID: SPACE, sprintId: '6f00000000000000000a0f01', deletedStatusKey: 0 });
});

afterEach(() => {
    [...__internals.calls.values()].forEach((call) => { if (call.timer) clearTimeout(call.timer); });
    __internals.calls.clear();
    __internals.activeByUser.clear();
    sockets.forEach(removeBySocket);
});

describe('starting a call', () => {
    it('rings the other person of a conversation the caller is in', async () => {
        const caller = connect(CALLER);
        connect(CALLEE);
        await caller.send('call:invite', { chatId: String(chat._id), media: 'audio' });

        expect(rung()).toHaveLength(1);
        expect(rung()[0].payload).toMatchObject({ chatId: String(chat._id), from: CALLER });
        expect(told(caller, 'call:ringing')).toHaveLength(1);
    });

    it.each([
        ['an object', { $ne: null }],
        ['a list', ['6f00000000000000000a0e01']],
        ['text that is not an id', 'every-chat'],
    ])('answers an error to a conversation named by %s, and reads nothing with it', async (name, chatId) => {
        const caller = connect(CALLER);
        connect(CALLEE);
        await caller.send('call:invite', { chatId });

        expect(told(caller, 'call:error')).toEqual([expect.objectContaining({ code: 'BAD_REQUEST' })]);
        expect(rung()).toHaveLength(0);
        expect(mockDb.calls.filter((call) => call.type === SCHEMA_TYPE.TASKS)).toHaveLength(0);
    });

    it('is refused to a person who no longer holds a seat', async () => {
        const caller = connect(CALLER);
        connect(CALLEE);
        seat(CALLER).isDelete = true;
        await caller.send('call:invite', { chatId: String(chat._id) });

        expect(told(caller, 'call:error')).toEqual([expect.objectContaining({ code: 'NOT_ALLOWED' })]);
        expect(rung()).toHaveLength(0);
        expect(__internals.calls.size).toBe(0);
    });

    it('does not ring a person who no longer holds a seat', async () => {
        const caller = connect(CALLER);
        connect(CALLEE);
        seat(CALLEE).status = 3;
        await caller.send('call:invite', { chatId: String(chat._id) });

        expect(told(caller, 'call:error')).toEqual([expect.objectContaining({ code: 'NOT_ALLOWED' })]);
        expect(rung()).toHaveLength(0);
        expect(historyLines()).toHaveLength(0);
    });
});

describe('declining a call', () => {
    it('tells the caller a short reason in words, whatever the request carries', async () => {
        const caller = connect(CALLER);
        const callee = connect(CALLEE);
        await caller.send('call:invite', { chatId: String(chat._id) });
        const { callId } = rung()[0].payload;

        callee.send('call:reject', { callId, reason: { html: '<b>x</b>' } });
        expect(sent.filter(({ event }) => event === 'call:rejected').map(({ payload }) => payload)).toEqual([{ callId, reason: 'declined' }]);
    });

    it('keeps a reason that is a short word', async () => {
        const caller = connect(CALLER);
        const callee = connect(CALLEE);
        await caller.send('call:invite', { chatId: String(chat._id) });
        const { callId } = rung()[0].payload;

        callee.send('call:reject', { callId, reason: 'busy' });
        expect(sent.filter(({ event }) => event === 'call:rejected').map(({ payload }) => payload)).toEqual([{ callId, reason: 'busy' }]);
    });
});

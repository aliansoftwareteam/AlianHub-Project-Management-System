const mockSent = [];
const mockRoom = (roomName) => ({
    roomName,
    namespace: { name: 'userid_c1_u1', to: () => ({ emit: (event, payload) => mockSent.push({ roomName, event, payload }) }) },
    socket: { identity: {}, rooms: new Set([roomName]) },
});

jest.mock('../socket/helper', () => ({
    joinRoom: jest.fn(), leaveRoom: jest.fn(), upsertRoom: jest.fn(), removeRoom: jest.fn(),
    findRoomsByPrefixes: (...prefixes) => prefixes.filter((prefix) => !prefix.endsWith('_')).map((prefix) => mockRoom(`${prefix}**socket-1`)),
}));
jest.mock('../socket/roomAccess', () => ({
    onJoin: jest.fn(), roomFor: jest.fn(), prefixOfOwnRoom: jest.fn(), isSelf: jest.fn(), canOpenTask: jest.fn(), canOpenSprintBoard: jest.fn(),
    mayReceiveTask: async () => true,
    inOrder: (run) => run(),
}));

require('../socket/controller/taskSocket');
const socketEmitter = require('../event/socketEventEmitter');

const TASK = { _id: 't1', ProjectID: 'p1', sprintId: 's1', ParentTaskId: '', TaskName: 'Write the brief', deletedStatusKey: 1 };
const change = (extra = {}) => ({ type: 'update', module: 'task', companyId: 'c1', data: TASK, updatedFields: { deletedStatusKey: 1 }, ...extra });
const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => { mockSent.length = 0; });

describe('the reason a task left its list', () => {
    test('reaches the list it left and the open task', async () => {
        socketEmitter.emit('update', change({ leftBecause: 'moved' }));
        await settle();

        expect(mockSent.map(({ event, payload }) => [event, payload.leftBecause])).toEqual([['taskUpdate', 'moved'], ['taskDetail_taskUpdate', 'moved']]);
        expect(mockSent[1].payload).toEqual({ fullDocument: TASK, updatedFields: { deletedStatusKey: 1 }, leftBecause: 'moved' });
    });

    test('is not sent with a delete', async () => {
        socketEmitter.emit('update', change());
        await settle();

        expect(mockSent).toHaveLength(2);
        mockSent.forEach(({ payload }) => expect(payload).toEqual({ fullDocument: TASK, updatedFields: { deletedStatusKey: 1 } }));
    });
});

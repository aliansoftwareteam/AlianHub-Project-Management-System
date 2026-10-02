jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => ({ roleType: 1 })) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const socketEmitter = require('../event/socketEventEmitter');
const helper = require('../socket/helper');
const { relay, EVENT } = require('../socket/controller/folderSocket');

const C = 'c00000000000000000000001';
const OTHER_COMPANY = 'c00000000000000000000002';
const OWNER = 'a00000000000000000000001';

const join = (companyId, socketId, { inRoom = true } = {}) => {
    const emit = jest.fn();
    const roomName = `selected_companies_${companyId}**${socketId}`;
    const socket = { id: socketId, rooms: new Set(inRoom ? [roomName] : []), identity: { companyId, uid: OWNER } };
    helper.upsertRoom({ roomName, socketId, socket, namespace: { to: jest.fn(() => ({ emit })) } });
    return emit;
};

describe('a folder write reaches the other open tabs of the company', () => {
    it('as the fact of a change and nothing else, and reaches no other company', async () => {
        const mine = join(C, 's1');
        const theirs = join(OTHER_COMPANY, 's2');
        await relay({ type: 'update', companyId: C, module: 'folders', data: { _id: 'f1', name: 'Secret roadmap', projectId: 'p1' } });
        expect(mine).toHaveBeenCalledWith(EVENT, { type: 'update' });
        expect(theirs).not.toHaveBeenCalled();
    });

    it('skips a socket that has left the company room', async () => {
        const left = join(C, 's3', { inRoom: false });
        await relay({ type: 'insert', companyId: C, module: 'folders' });
        expect(left).not.toHaveBeenCalled();
    });

    it('does nothing without a company', async () => {
        const mine = join(C, 's4');
        await relay({ type: 'update', module: 'folders' });
        await relay(undefined);
        expect(mine).not.toHaveBeenCalled();
    });

    it('is named foldersChanged and listens for folder creates and updates', () => {
        expect(EVENT).toBe('foldersChanged');
        expect(socketEmitter.on.mock.calls.map(([event]) => event)).toEqual(expect.arrayContaining(['folders:insert', 'folders:update']));
    });

    it('is loaded with the socket server', () => {
        const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'socket', 'socketinit.js'), 'utf8');
        expect(source).toMatch(/require\('\.\/controller\/folderSocket'\)/);
    });
});

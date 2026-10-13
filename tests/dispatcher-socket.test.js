const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const socketEmitter = require('../event/socketEventEmitter');
const helper = require('../socket/helper');
const { relay, EVENT } = require('../socket/controller/dispatcherSocket');

const { SCHEMA_TYPE } = require('../Config/schemaType');

const C = 'c00000000000000000000001';
const OTHER = 'c00000000000000000000002';
const UID = 'a00000000000000000000001';

beforeAll(() => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: UID, roleType: 3, status: 2, isDelete: false }));

const join = (companyId, socketId) => {
    const emit = jest.fn();
    const roomName = `selected_companies_${companyId}**${socketId}`;
    const socket = { id: socketId, rooms: new Set([roomName]), identity: { companyId, uid: UID } };
    helper.upsertRoom({ roomName, socketId, socket, namespace: { to: jest.fn(() => ({ emit })) } });
    return emit;
};

describe('the dispatcher live update', () => {
    it('tells the company\'s sockets the kind of change, with no task or project in it', async () => {
        const mine = join(C, 'd1');
        const theirs = join(OTHER, 'd2');
        await relay({ type: 'update', module: 'dispatchDecisions', companyId: C, data: { taskId: 'x', projectId: 'y', state: 'suggested' } });
        expect(mine).toHaveBeenCalledWith(EVENT, { kind: 'dispatchDecisions' });
        expect(theirs).not.toHaveBeenCalled();
    });

    it('relays both the decisions and the settings events', async () => {
        const mine = join(C, 'd3');
        socketEmitter.emit('update', { type: 'update', module: 'dispatcherSettings', companyId: C, data: { projectId: 'y' } });
        socketEmitter.emit('update', { type: 'update', module: 'dispatchDecisions', companyId: C, data: {} });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(mine.mock.calls.map(([, payload]) => payload.kind)).toEqual(['dispatcherSettings', 'dispatchDecisions']);
    });
});

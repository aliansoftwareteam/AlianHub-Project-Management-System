const mockCrud = jest.fn();
const mockReadable = jest.fn();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../socket/roomAccess', () => ({ ...jest.requireActual('../socket/roomAccess'), readablePage: (...a) => mockReadable(...a) }));

const socketEmitter = require('../event/socketEventEmitter');
const helper = require('../socket/helper');
const { relayAdded, ADDED_EVENT } = require('../socket/controller/pageShareSocket');

const C = '6f0000000000000000000c31';
const OTHER_COMPANY = '6f0000000000000000000c32';
const PAGE = '6f0000000000000000000f31';
const READER = '6f0000000000000000000a31';
const NOT_SHARED = '6f0000000000000000000a32';

const seat = (companyId, socketId, uid) => {
    const emit = jest.fn();
    const roomName = `selected_companies_${companyId}**${socketId}`;
    const socket = { id: socketId, rooms: new Set([roomName]), identity: { companyId, uid }, emit };
    helper.upsertRoom({ roomName, socketId, socket, namespace: { to: jest.fn(() => ({ emit: jest.fn() })) } });
    return emit;
};

describe('a new doc', () => {
    let reader;
    let notShared;
    let elsewhere;

    beforeEach(() => {
        mockCrud.mockResolvedValue({ roleType: 3 });
        mockReadable.mockReset();
        mockReadable.mockImplementation(async (identity, pageId) => (identity.uid === READER && pageId === PAGE ? { _id: PAGE } : null));
        reader = seat(C, 'd1', READER);
        notShared = seat(C, 'd2', NOT_SHARED);
        elsewhere = seat(OTHER_COMPANY, 'd3', READER);
    });
    afterEach(() => {
        helper.removeRoom(`selected_companies_${C}**d1`);
        helper.removeRoom(`selected_companies_${C}**d2`);
        helper.removeRoom(`selected_companies_${OTHER_COMPANY}**d3`);
    });

    it('listens to every doc insert, whether the web app or an agent made it', () => {
        expect(socketEmitter.on.mock.calls.map(([event]) => event)).toContain('pages:insert');
    });

    it('is told to the people who can open it in that company, and carries nothing of the doc', async () => {
        await relayAdded({ type: 'insert', module: 'pages', companyId: C, data: { _id: PAGE, title: 'Agent notes' } });
        expect(reader).toHaveBeenCalledWith(ADDED_EVENT, { type: 'insert' });
        expect(notShared).not.toHaveBeenCalled();
        expect(elsewhere).not.toHaveBeenCalled();
    });

    it('is told to nobody when it names no doc or its access cannot be read', async () => {
        await relayAdded({ type: 'insert', module: 'pages', companyId: C, data: {} });
        mockReadable.mockRejectedValue(new Error('down'));
        await relayAdded({ type: 'insert', module: 'pages', companyId: C, data: { _id: PAGE } });
        expect(reader).not.toHaveBeenCalled();
        expect(notShared).not.toHaveBeenCalled();
    });
});

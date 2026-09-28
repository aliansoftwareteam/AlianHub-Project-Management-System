const mockCreated = [];
const mockPool = [];

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../middlewares/mongoConnector/helper', () => ({
    connections: mockPool,
    checkConnectionExists: ({ connections, db }) => connections.find((entry) => entry.db === db) || null,
    updateConnectionRecord: (db, conData = {}) => {
        if (!mockPool.some((entry) => entry.db === db)) mockPool.push({ ...conData });
    },
    createConnection: async (db) => {
        mockCreated.push(db);
        return { db, connection: { close: jest.fn() }, createdAt: 0, lastRequest: 0 };
    },
    closeConnection: jest.fn(),
}));

const mongoose = require('mongoose');
const { handleConnection } = require('../middlewares/mongoConnector/mongoConnection');
const { connect } = require('../utils/mongo-handler/mongoConnector');

const COMPANY = '6f0000000000000000000f02';

beforeEach(() => {
    mockCreated.length = 0;
    mockPool.length = 0;
});

afterEach(() => jest.restoreAllMocks());

const NOT_DATABASES = ['admin', 'local', 'config', 'USER_PROFILES', 'Global', 'global2', `${COMPANY}x`, '', '../x', 'a b'];

describe('a connection is opened only for the global database or a company id', () => {
    it.each(NOT_DATABASES)('handleConnection refuses %p without opening a connection', async (name) => {
        await expect(handleConnection(name)).rejects.toMatchObject({ status: false });
        expect(mockCreated).toEqual([]);
    });

    it.each(['global', COMPANY])('handleConnection opens %p', async (name) => {
        await expect(handleConnection(name)).resolves.toMatchObject({ status: true });
        expect(mockCreated).toEqual([name]);
    });

    it('handleConnection accepts a company ObjectId as well as its hex string', async () => {
        await expect(handleConnection(new mongoose.Types.ObjectId(COMPANY))).resolves.toMatchObject({ status: true });
    });

    it.each(NOT_DATABASES)('connect refuses %p before dialling the server', async (name) => {
        process.env.MONGODB_URL = process.env.MONGODB_URL || 'mongodb://127.0.0.1:1';
        const dial = jest.spyOn(mongoose, 'createConnection').mockImplementation(() => { throw new Error('dialled the server'); });
        await expect(connect(name)).rejects.toThrow('Invalid database name');
        expect(dial).not.toHaveBeenCalled();
    });
});

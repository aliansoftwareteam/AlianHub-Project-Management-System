const mockPool = [];
const mockCreated = [];
const mockGate = { opened: null };
const mockGlobalFindOne = jest.fn(async () => null);

function mockCompanyConnection() {
    const connection = {
        compiled: 0,
        close: jest.fn(),
        model: jest.fn(() => {
            connection.compiled += 1;
            return { init: async () => {}, findOne: jest.fn(async () => ({ roleType: 1 })) };
        }),
    };
    return connection;
}

function mockGlobalConnection() {
    return { close: jest.fn(), db: { collection: () => ({ findOne: mockGlobalFindOne }) } };
}

jest.mock('../middlewares/mongoConnector/helper', () => ({
    connections: mockPool,
    checkConnectionExists: ({ connections, db }) => connections.find((entry) => entry.db === db) || null,
    updateConnectionRecord: (db, conData = {}) => {
        if (!mockPool.some((entry) => entry.db === db)) mockPool.push({ ...conData });
    },
    createConnection: async (db) => {
        mockCreated.push(db);
        if (mockGate.opened) await mockGate.opened;
        const connection = db === 'global' ? mockGlobalConnection() : mockCompanyConnection();
        return { db, connection, createdAt: 0, lastRequest: 0 };
    },
    closeConnection: (db) => {
        const index = mockPool.findIndex((entry) => entry.db === db);
        if (index === -1) return;
        mockPool[index].connection.close();
        mockPool.splice(index, 1);
    },
}));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { myCache } = require('../Config/config');
const { MongoDbCrudOpration, dropCompanyDatabase } = require('../utils/mongo-handler/mongoQueries');
const { verifyCompanyMembership } = require('../Config/jwt');

let nextCompany = 0;
const freshCompany = () => `6f00000000000000000d${String(nextCompany++).padStart(4, '0')}`;
const USER = '6f00000000000000000a0001';

const readSeat = (companyId) => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMPANY_USERS, data: [{ userId: USER }] }, 'findOne');
const pooled = (companyId) => mockPool.some((entry) => entry.db === companyId);
const opened = (companyId) => mockCreated.filter((db) => db === companyId).length;
const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise(setImmediate); };

let dropped;
let releaseDrop;
const holdDrop = () => dropped.mockImplementation(() => new Promise((resolve) => { releaseDrop = resolve; }));

beforeEach(() => {
    mockPool.length = 0;
    mockCreated.length = 0;
    mockGate.opened = null;
    mockGlobalFindOne.mockReset();
    mockGlobalFindOne.mockResolvedValue(null);
    mockPool.push({ db: 'global', connection: mockGlobalConnection(), createdAt: 0, lastRequest: 0 });
    dropped = jest.fn(async () => true);
    jest.spyOn(mongoose, 'createConnection').mockReturnValue({
        asPromise: async () => ({ dropDatabase: dropped, close: jest.fn(async () => {}) }),
    });
});

afterEach(() => jest.restoreAllMocks());

describe('a company being deleted', () => {
    it('refuses a request that arrives while its database is being dropped, and opens no connection that could recreate it', async () => {
        const company = freshCompany();
        await readSeat(company);
        expect(pooled(company)).toBe(true);
        mockCreated.length = 0;

        holdDrop();
        const deletion = dropCompanyDatabase(company);
        await flush();
        expect(dropped).toHaveBeenCalledTimes(1);

        await expect(readSeat(company)).rejects.toMatchObject({ status: false });
        expect(opened(company)).toBe(0);
        expect(pooled(company)).toBe(false);

        releaseDrop();
        await deletion;

        await expect(readSeat(company)).rejects.toMatchObject({ status: false });
        expect(opened(company)).toBe(0);
        expect(pooled(company)).toBe(false);
    });

    it('does not pool a connection that was still opening when the deletion started', async () => {
        const company = freshCompany();
        let openGate;
        mockGate.opened = new Promise((resolve) => { openGate = resolve; });

        const request = readSeat(company);
        await flush();
        mockGate.opened = null;

        await dropCompanyDatabase(company);
        openGate();

        await expect(request).rejects.toMatchObject({ status: false });
        expect(pooled(company)).toBe(false);
    });

    it('refuses to open a company whose global row says another process is deleting it', async () => {
        const company = freshCompany();
        mockGlobalFindOne.mockResolvedValue({ _id: company });

        await expect(readSeat(company)).rejects.toMatchObject({ status: false });
        expect(opened(company)).toBe(0);
        expect(mockGlobalFindOne).toHaveBeenCalledWith(
            expect.objectContaining({ deletingAt: { $exists: true } }),
            expect.anything(),
        );
    });

    it('fails the membership check while the deletion runs, even with a membership cached as true', async () => {
        const company = freshCompany();
        myCache.set(`membership:${USER}:${company}`, true, 60);

        holdDrop();
        const deletion = dropCompanyDatabase(company);
        await flush();

        expect(await verifyCompanyMembership(USER, company)).toBe(false);

        releaseDrop();
        await deletion;
        myCache.del(`membership:${USER}:${company}`);
    });

    it('lets the company be used again when the drop itself fails', async () => {
        const company = freshCompany();
        dropped.mockImplementation(async () => { throw new Error('drop failed'); });

        await expect(dropCompanyDatabase(company)).rejects.toThrow('drop failed');

        await expect(readSeat(company)).resolves.toEqual({ roleType: 1 });
        expect(pooled(company)).toBe(true);
    });
});

const mockPool = [];
jest.mock('../middlewares/mongoConnector/helper', () => ({
    connections: mockPool,
    checkConnectionExists: ({ connections, db }) => connections.find((entry) => entry.db === db) || null,
    closeConnection: (db) => {
        const index = mockPool.findIndex((entry) => entry.db === db);
        if (index === -1) return;
        mockPool[index].connection.close();
        mockPool.splice(index, 1);
    },
}));
jest.mock('../middlewares/mongoConnector/mongoConnection', () => ({
    handleConnection: async (db) => {
        const pooled = mockPool.find((entry) => entry.db === db);
        return pooled ? { status: true, database: pooled.connection } : { status: false, statusText: 'no connection' };
    },
}));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { dropOrphanDatabase } = require('../Modules/Instance/backups');

const ORPHAN = '6f0000000000000000000e01';

/* The pooled connection's schema init stays pending until the test lets it finish, the way an
 * unawaited createCollection + createIndexes does after a read. */
const orphanConnection = () => {
    const pendingInits = [];
    const connection = {
        close: jest.fn(),
        model: jest.fn(() => {
            let finish;
            const init = new Promise((resolve) => { finish = resolve; });
            pendingInits.push(finish);
            return { init: () => init, findOne: jest.fn(async () => null) };
        }),
        finishInits: () => pendingInits.forEach((finish) => finish()),
    };
    return connection;
};

let dropped;
const globalConnection = () => ({
    close: jest.fn(),
    db: {
        admin: () => ({ listDatabases: async () => ({ databases: [{ name: ORPHAN, sizeOnDisk: 4096 }] }) }),
        collection: () => ({ distinct: async () => [] }),
        client: { db: () => ({ dropDatabase: dropped }) },
    },
});

const pool = (db, connection) => mockPool.push({ db, connection, createdAt: 0, lastRequest: 0 });
const readFromOrphan = () => MongoDbCrudOpration(ORPHAN, { type: SCHEMA_TYPE.COMPANY_USERS, data: [{ userId: 'u' }] }, 'findOne');
const dropIt = () => dropOrphanDatabase({ name: ORPHAN, confirm: ORPHAN });

beforeEach(() => {
    mockPool.length = 0;
    dropped = jest.fn(async () => true);
    pool('global', globalConnection());
    jest.spyOn(mongoose, 'createConnection').mockReturnValue({
        asPromise: async () => ({ dropDatabase: dropped, close: jest.fn(async () => {}) }),
    });
});

afterEach(() => jest.restoreAllMocks());

describe('dropping an orphaned company database', () => {
    it('drops only after the schema init a pooled connection started has settled', async () => {
        const connection = orphanConnection();
        pool(ORPHAN, connection);
        await readFromOrphan();

        const drop = dropIt();
        await new Promise(setImmediate);
        expect(dropped).not.toHaveBeenCalled();

        connection.finishInits();
        await drop;

        expect(dropped).toHaveBeenCalledTimes(1);
    });

    it('closes the pooled connection before the drop, so nothing it started lands on a dropped database', async () => {
        const connection = orphanConnection();
        pool(ORPHAN, connection);
        await readFromOrphan();
        connection.finishInits();

        await dropIt();

        expect(connection.close).toHaveBeenCalledTimes(1);
        expect(dropped).toHaveBeenCalledTimes(1);
        expect(connection.close.mock.invocationCallOrder[0]).toBeLessThan(dropped.mock.invocationCallOrder[0]);
        expect(mockPool.some((entry) => entry.db === ORPHAN)).toBe(false);
    });

    it('still refuses a database a company references', async () => {
        mockPool[0].connection.db.collection = () => ({ distinct: async () => [ORPHAN] });

        await expect(dropIt()).rejects.toMatchObject({ statusCode: 409 });
        expect(dropped).not.toHaveBeenCalled();
    });
});

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
const { MongoDbCrudOpration, dropCompanyDatabase } = require('../utils/mongo-handler/mongoQueries');

const COMPANY = '6f0000000000000000000c01';

/* Mongoose starts a model's init (createCollection + createIndexes) when the model is compiled and
 * never awaits it; the fake keeps each init pending until the test lets it finish. */
const fakeConnection = () => {
    const pendingInits = [];
    const connection = {
        compiled: 0,
        close: jest.fn(),
        model: jest.fn(() => {
            connection.compiled += 1;
            let finish;
            const init = new Promise((resolve) => { finish = resolve; });
            pendingInits.push(finish);
            return { init: () => init, findOne: jest.fn(async () => ({ roleType: 1 })) };
        }),
        finishInits: () => pendingInits.forEach((finish) => finish()),
    };
    return connection;
};

const pool = (connection) => mockPool.push({ db: COMPANY, connection, createdAt: 0, lastRequest: 0 });
const readSeat = () => MongoDbCrudOpration(COMPANY, { type: SCHEMA_TYPE.COMPANY_USERS, data: [{ userId: 'u' }] }, 'findOne');

let dropped;
beforeEach(() => {
    mockPool.length = 0;
    dropped = jest.fn(async () => true);
    jest.spyOn(mongoose, 'createConnection').mockReturnValue({
        asPromise: async () => ({ dropDatabase: dropped, close: jest.fn(async () => {}) }),
    });
});

afterEach(() => jest.restoreAllMocks());

describe('company database drop', () => {
    it('compiles a collection model once per connection, so queries stop re-running its createCollection and createIndexes', async () => {
        const connection = fakeConnection();
        pool(connection);

        await readSeat();
        await readSeat();
        await readSeat();

        expect(connection.compiled).toBe(1);
    });

    it('drops only after the schema init the last reads started has settled, so it cannot land after the drop and recreate the database', async () => {
        const connection = fakeConnection();
        pool(connection);
        await readSeat();

        let settled = false;
        const drop = dropCompanyDatabase(COMPANY).then(() => { settled = true; });
        await new Promise(setImmediate);

        expect(dropped).not.toHaveBeenCalled();
        expect(settled).toBe(false);

        connection.finishInits();
        await drop;

        expect(dropped).toHaveBeenCalledTimes(1);
    });

    it('retires the pooled connection before the drop, so nothing reuses it against the dropped database', async () => {
        const connection = fakeConnection();
        pool(connection);
        await readSeat();
        connection.finishInits();

        await dropCompanyDatabase(COMPANY);

        expect(connection.close.mock.invocationCallOrder[0]).toBeLessThan(dropped.mock.invocationCallOrder[0]);
        expect(mockPool).toHaveLength(0);
    });

    it('drops a company with no pooled connection', async () => {
        await dropCompanyDatabase(COMPANY);

        expect(dropped).toHaveBeenCalledTimes(1);
    });
});

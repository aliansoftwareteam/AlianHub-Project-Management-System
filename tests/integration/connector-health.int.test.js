/* Task 070's writes to a connection against a real MongoDB, through the real functions the tool runner calls: the
 * unit tests mock them or use a fake, which is how a missing recordHealth went unnoticed. Each company gets a
 * throwaway database of its own, dropped after, so a write that crossed companies would show. */
const mongoose = require('mongoose');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { connectorConnectionsSchema } = require('../../utils/mongo-handler/createSchema');
const { SCHEMA_TYPE } = require('../../Config/schemaType');

let mockModels;
jest.mock('../../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, { type, data }, method) => mockModels[companyId][type][method](...data),
}));
jest.mock('../../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const logger = require('../../Config/loggerConfig');
const health = require('../../Modules/Connectors/health');
const rateLimits = require('../../Modules/Connectors/rateLimits');
const { recordHealth } = require('../../Modules/Connectors/resolveConnection');

const C = '6f0000000000000000000c01';
const OTHER = '6f0000000000000000000c02';
const RUN = `${process.pid}_${Date.now()}`;

let connection;
const dbs = [];
const rows = (companyId = C) => mockModels[companyId][SCHEMA_TYPE.CONNECTOR_CONNECTIONS];
const added = async (fields = {}, companyId = C) => {
    const row = await rows(companyId).create({ companyId, userId: 'u1', provider: 'google', handles: { refresh: 'sec_r' }, ...fields });
    return String(row._id);
};
const read = (id, companyId = C) => rows(companyId).findById(id).lean();

beforeAll(async () => {
    connection = await mongoose.createConnection(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 }).asPromise();
    mockModels = {};
    [C, OTHER].forEach((companyId) => {
        const db = connection.useDb(`it_connector_health_${companyId.slice(-2)}_${RUN}`);
        dbs.push(db);
        mockModels[companyId] = { [SCHEMA_TYPE.CONNECTOR_CONNECTIONS]: db.model(SCHEMA_TYPE.CONNECTOR_CONNECTIONS, connectorConnectionsSchema.clone().clearIndexes(), SCHEMA_TYPE.CONNECTOR_CONNECTIONS) };
    });
});

afterAll(async () => {
    await Promise.all(dbs.map((db) => db.dropDatabase()));
    if (connection) await connection.close();
});

describe('recordHealth', () => {
    it('saves what it is given and leaves out what it is not', async () => {
        const id = await added();
        const usedAt = new Date(Date.now() - 60000);
        await recordHealth({ companyId: C, connectionId: id, lastUsedAt: usedAt, lastError: 'ECONNRESET' });
        expect(await read(id)).toMatchObject({ lastUsedAt: usedAt, lastError: 'ECONNRESET', status: 'connected' });

        await recordHealth({ companyId: C, connectionId: id, lastError: '' });
        expect(await read(id)).toMatchObject({ lastUsedAt: usedAt, lastError: '' });
    });

    it('cuts a long error to the length a broken reason keeps', async () => {
        const id = await added();
        await recordHealth({ companyId: C, connectionId: id, lastError: 'x'.repeat(200) });
        expect((await read(id)).lastError).toHaveLength(60);
    });

    it('writes to a row older than the status field', async () => {
        const id = await added();
        await rows().collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $unset: { status: '' } });
        await recordHealth({ companyId: C, connectionId: id, lastError: 'ECONNRESET' });
        expect((await read(id)).lastError).toBe('ECONNRESET');
    });

    it('leaves a broken row and its reason alone', async () => {
        const id = await added({ status: 'broken', lastError: 'invalid_grant' });
        await recordHealth({ companyId: C, connectionId: id, lastUsedAt: new Date(), lastError: '' });
        const row = await read(id);
        expect(row).toMatchObject({ status: 'broken', lastError: 'invalid_grant' });
        expect(row.lastUsedAt).toBeUndefined();
    });

    it('keeps the broken reason when calls finish while the row is being marked broken', async () => {
        const id = await added();
        await Promise.all([
            ...Array.from({ length: 25 }, () => recordHealth({ companyId: C, connectionId: id, lastUsedAt: new Date(), lastError: '' })),
            rows().findOneAndUpdate({ _id: id }, { $set: { status: 'broken', lastError: 'invalid_grant' } }),
            ...Array.from({ length: 25 }, () => recordHealth({ companyId: C, connectionId: id, lastUsedAt: new Date(), lastError: 'provider_refused' })),
        ]);
        await recordHealth({ companyId: C, connectionId: id, lastError: '' });
        expect(await read(id)).toMatchObject({ status: 'broken', lastError: 'invalid_grant' });
    });

    it("cannot touch another company's connection with its id", async () => {
        const theirs = await added({ lastError: 'theirs' }, OTHER);
        await recordHealth({ companyId: C, connectionId: theirs, lastError: 'mine' });
        expect((await read(theirs, OTHER)).lastError).toBe('theirs');
        expect(await read(theirs, C)).toBeNull();
    });

    it('does nothing when it is given nothing to save', async () => {
        const id = await added({ lastError: 'kept' });
        await expect(recordHealth({ companyId: C, connectionId: id })).resolves.toBeUndefined();
        await expect(recordHealth({ companyId: C, lastError: 'lost' })).resolves.toBeUndefined();
        await expect(recordHealth()).resolves.toBeUndefined();
        expect((await read(id)).lastError).toBe('kept');
    });
});

describe('what the tool runner calls', () => {
    it('a use clears the last error and a failure sets it', async () => {
        const id = await added();
        await health.noteFailure(C, id, 'provider_refused');
        expect(await read(id)).toMatchObject({ lastError: 'provider_refused', lastUsedAt: expect.any(Date) });
        await health.noteUse(C, id);
        expect((await read(id)).lastError).toBe('');
    });

    it('a token failure sets the last error and does not call the connection used', async () => {
        const id = await added();
        await health.noteTokenFailure(C, id, 'refresh_failed');
        const row = await read(id);
        expect(row.lastError).toBe('refresh_failed');
        expect(row.lastUsedAt).toBeUndefined();
    });

    it('a bad id is logged and does not fail the call being recorded', async () => {
        logger.error.mockClear();
        await expect(health.noteUse(C, 'not-an-id')).resolves.toBeUndefined();
        await expect(health.noteUse(C, undefined)).resolves.toBeUndefined();
        expect(logger.error).toHaveBeenCalledTimes(2);
        expect(logger.error.mock.calls[0][0]).toContain('CastError');
    });

    it('a Retry-After holds the connection until then, and not after', async () => {
        const id = await added();
        expect(await rateLimits.heldUntil(C, id)).toBeNull();
        const until = await rateLimits.hold(C, id, { status: 429, headers: { 'retry-after': '120' }, body: '{}' });
        expect((await read(id)).backoffUntil).toEqual(until);
        expect(await rateLimits.heldUntil(C, id)).toEqual(until);
        expect(await rateLimits.heldUntil(C, id, until.getTime() + 1)).toBeNull();
        expect(await rateLimits.heldUntil(OTHER, id)).toBeNull();
    });

    it('a hold that cannot be saved still answers when to come back', async () => {
        logger.error.mockClear();
        const until = await rateLimits.hold(C, 'not-an-id', { status: 429, headers: { 'retry-after': '120' }, body: '{}' });
        expect(until.getTime()).toBeGreaterThan(Date.now());
        expect(logger.error).toHaveBeenCalledTimes(1);
    });
});

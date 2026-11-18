jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const logger = require('../Config/loggerConfig');
const persistence = require('../Modules/AICore/persistence');

const C1 = '6f0000000000000000000c01';
const C2 = '6f0000000000000000000c02';

describe('agent persistence — one store and checkpointer per company', () => {
    let mem;
    beforeEach(() => { mem = persistence.useInMemory(); });
    afterEach(() => { mem.reset(); persistence.useMongo(); });

    it('refuses to open without a companyId', () => {
        expect(() => persistence.storeFor('')).toThrow(/companyId is required/);
        expect(() => persistence.saverFor(undefined)).toThrow(/companyId is required/);
    });

    it('returns the same instance for the same company and different ones per company', () => {
        expect(persistence.storeFor(C1)).toBe(persistence.storeFor(C1));
        expect(persistence.storeFor(C1)).not.toBe(persistence.storeFor(C2));
        expect(persistence.saverFor(C1)).toBe(persistence.saverFor(C1));
        expect(persistence.saverFor(C1)).not.toBe(persistence.saverFor(C2));
    });

    it('never lets one company read another company\'s memory', async () => {
        await persistence.storeFor(C1).put(['project', 'p1', 'decision'], 'budget', { text: 'budget fixed' });
        const own = await persistence.storeFor(C1).search(['project', 'p1', 'decision']);
        const other = await persistence.storeFor(C2).search(['project', 'p1', 'decision']);
        expect(own.map((r) => r.key)).toEqual(['budget']);
        expect(other).toEqual([]);
    });

    it('names the Mongo collections the schema registration expects', () => {
        expect(persistence.COLLECTIONS).toEqual({ STORE: 'agent_memory', CHECKPOINTS: 'agent_checkpoints', CHECKPOINT_WRITES: 'agent_checkpoint_writes' });
    });
});

describe('mongo-backed instances (constructed, never connected)', () => {
    const env = { NODE_ENV: process.env.NODE_ENV, MONGODB_URL: process.env.MONGODB_URL };
    beforeAll(() => { process.env.NODE_ENV = 'development'; process.env.MONGODB_URL = 'mongodb://127.0.0.1:1'; persistence.useMongo(); });
    afterAll(async () => { await persistence.close(); process.env.NODE_ENV = env.NODE_ENV; process.env.MONGODB_URL = env.MONGODB_URL; });

    it('opens each company in its own database, on the declared collections, over one shared client', () => {
        expect(persistence.storeFor(C1).db.databaseName).toBe(C1);
        expect(persistence.saverFor(C1).db.databaseName).toBe(C1);
        expect(persistence.storeFor(C2).db.databaseName).toBe(C2);
        expect(persistence.storeFor(C1).collectionName).toBe(persistence.COLLECTIONS.STORE);
        expect(persistence.saverFor(C1).checkpointCollectionName).toBe(persistence.COLLECTIONS.CHECKPOINTS);
        expect(persistence.saverFor(C1).checkpointWritesCollectionName).toBe(persistence.COLLECTIONS.CHECKPOINT_WRITES);
        expect(persistence.saverFor(C1).ttl).toBe(persistence.CHECKPOINT_TTL_SECONDS);
        expect(persistence.storeFor(C1).client).toBe(persistence.saverFor(C2).client);
    });

    it('ready() builds the indexes once per company and resolves even when the build fails', async () => {
        const store = persistence.storeFor(C1);
        const saver = persistence.saverFor(C1);
        const start = jest.spyOn(store, 'start').mockRejectedValue(new Error('store index refused'));
        const setup = jest.spyOn(saver, 'setup').mockResolvedValue([new Error('ttl index refused')]);
        await expect(persistence.ready(C1)).resolves.toBeUndefined();
        await expect(persistence.ready(C1)).resolves.toBeUndefined();
        expect(start).toHaveBeenCalledTimes(1);
        expect(setup).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('store index refused'));
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('ttl index refused'));
    });

    it('close() drops the cached instances so the next call builds fresh ones', async () => {
        const before = persistence.storeFor(C1);
        await persistence.close();
        expect(persistence.storeFor(C1)).not.toBe(before);
    });

    it('refuses to reach Mongo under jest unless the in-memory override is active', async () => {
        await persistence.close();
        process.env.NODE_ENV = 'test';
        expect(() => persistence.storeFor(C1)).toThrow(/useInMemory/);
        process.env.NODE_ENV = 'development';
    });
});

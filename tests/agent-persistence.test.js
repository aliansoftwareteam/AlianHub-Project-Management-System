jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const persistence = require('../Modules/Agents/engine/persistence');

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

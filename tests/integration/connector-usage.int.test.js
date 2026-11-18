/* Task 070's writes against a real MongoDB, where an upsert that named `actor` twice would be refused and the fake
 * would not notice. Uses a throwaway database of its own, dropped after. */
const mongoose = require('mongoose');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { connectorUsageSchema, connectorQuotasSchema } = require('../../utils/mongo-handler/createSchema');
const { SCHEMA_TYPE } = require('../../Config/schemaType');

let mockModels;
jest.mock('../../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, { type, data }, method) => mockModels[type][method](...data),
}));
jest.mock('../../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));

const usage = require('../../Modules/Connectors/usage');
const quotas = require('../../Modules/Connectors/quotas');

const DB = `it_connector_usage_${process.pid}_${Date.now()}`;
const C = '6f0000000000000000000c01';
const PERSON = '6f0000000000000000000a01';
const AGENT = '6f0000000000000000000b01';
const who = (connectionId = 'conn-1', actor = { type: 'agent', id: AGENT }) => ({ connectionId, userId: PERSON, actor });

let connection;

beforeAll(async () => {
    connection = await mongoose.createConnection(`${resolveMongoUrl()}/${DB}`, { serverSelectionTimeoutMS: 5000 }).asPromise();
    mockModels = {
        [SCHEMA_TYPE.CONNECTOR_USAGE]: connection.model(SCHEMA_TYPE.CONNECTOR_USAGE, connectorUsageSchema, SCHEMA_TYPE.CONNECTOR_USAGE),
        [SCHEMA_TYPE.CONNECTOR_QUOTAS]: connection.model(SCHEMA_TYPE.CONNECTOR_QUOTAS, connectorQuotasSchema, SCHEMA_TYPE.CONNECTOR_QUOTAS),
    };
    await Promise.all(Object.values(mockModels).map((model) => model.init()));
});

afterAll(async () => {
    if (connection) {
        await connection.dropDatabase();
        await connection.close();
    }
});

beforeEach(() => Promise.all(Object.values(mockModels).map((model) => model.deleteMany({}))));

describe('connector_usage in MongoDB', () => {
    const rows = () => mockModels[SCHEMA_TYPE.CONNECTOR_USAGE].find({}).lean();

    it('keeps one row per caller and day, with the actor built from the filter', async () => {
        const { release } = await quotas.claimRead(C, who());
        await quotas.claimRead(C, who());
        expect(await rows()).toEqual([expect.objectContaining({
            companyId: C, connectionId: 'conn-1', userId: PERSON, actor: { type: 'agent', id: AGENT }, day: usage.dayOf(), reads: 2, writeProposals: 0,
        })]);
        await release();
        expect((await rows())[0].reads).toBe(1);
    });

    it('stops racing reads at the limit: none past it, whatever the order', async () => {
        await quotas.set(C, { scope: 'workspace', reads: 5 }, { id: PERSON, ip: '' });
        const outcomes = await Promise.allSettled(Array.from({ length: 12 }, () => quotas.claimRead(C, who('conn-1', { type: 'mcp', id: 'client' }))));
        expect(outcomes.filter((o) => o.status === 'fulfilled').length).toBeLessThanOrEqual(5);
        expect(outcomes.filter((o) => o.status === 'rejected').every((o) => o.reason.code === 'quota_reached')).toBe(true);
        expect((await rows()).reduce((sum, row) => sum + row.reads, 0)).toBe(outcomes.filter((o) => o.status === 'fulfilled').length);
    });
});

describe('connector_quotas in MongoDB', () => {
    it('saves, reads back and clears a limit, on one row per target', async () => {
        await quotas.set(C, { scope: 'workspace', reads: 7, agentReads: 3 }, { id: PERSON, ip: '' });
        await quotas.set(C, { scope: 'workspace', reads: 8 }, { id: PERSON, ip: '' });
        expect(await quotas.limitsFor(C, PERSON, AGENT)).toEqual({ reads: 8, writeProposals: 50, agentReads: 3 });
        await quotas.set(C, { scope: 'workspace', agentReads: null }, { id: PERSON, ip: '' });
        expect((await quotas.limitsFor(C, PERSON, AGENT)).agentReads).toBe(200);
        expect(await mockModels[SCHEMA_TYPE.CONNECTOR_QUOTAS].countDocuments({})).toBe(1);
    });
});

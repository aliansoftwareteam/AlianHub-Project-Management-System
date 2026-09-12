/* The budget reservation against a real MongoDB: the indexes migration 015
 * builds, the strict schema keeping every field the reserver writes, and the
 * aggregate that decides whether a call fits — none of which fakeMongo can
 * answer for. */
const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { readState } = require('../../e2e/support/fixtures');
const { dbCollections } = require('../../Config/collections');
const { aiReservationsSchema } = require('../../utils/mongo-handler/createSchema');

const state = readState();
const COLLECTION = dbCollections.AI_RESERVATIONS;
const MINUTE = 60000;

const month = new Date().toISOString().slice(0, 7);
const from = new Date(`${month}-01T00:00:00.000Z`);
const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));

const heldPipeline = (now, upTo) => [
    { $match: { state: 'held', at: { $gte: from, $lt: to }, expiresAt: { $gt: now }, ...(upTo ? { _id: { $lte: upTo } } : {}) } },
    { $group: { _id: null, usd: { $sum: '$amountUsd' } } },
];

const hold = (over = {}) => ({
    companyId: state.companyId, feature: 'agent_run', state: 'held', amountUsd: 1,
    at: new Date(), settledAt: null, expiresAt: new Date(Date.now() + 15 * MINUTE), ...over,
});

describe('ai reservations (AI-04)', () => {
    let client;
    let rows;
    let connection;
    let model;

    beforeAll(async () => {
        client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
        await client.connect();
        rows = client.db(state.companyId).collection(COLLECTION);
        connection = await mongoose.createConnection(`${resolveMongoUrl()}/${state.companyId}`).asPromise();
        model = connection.model(COLLECTION, aiReservationsSchema, COLLECTION);
        await model.init();
    });

    afterAll(async () => {
        if (connection) await connection.close();
        if (client) await client.close();
    });

    beforeEach(async () => { await rows.deleteMany({}); });

    /* Migration 015 builds these ahead of the first write for a company that
     * already exists; a company created afterwards gets them from the schema,
     * which is the path this asserts. */
    it('carries the TTL index that deletes a stranded hold', async () => {
        const indexes = await rows.indexes();
        const ttl = indexes.find((index) => index.key && index.key.expiresAt === 1);
        expect(ttl).toBeDefined();
        expect(ttl.expireAfterSeconds).toBe(0);
        expect(indexes.some((index) => index.key && index.key.state === 1 && index.key.at === -1)).toBe(true);
    });

    it('keeps every field the reserver writes through the strict schema', async () => {
        const at = new Date();
        const saved = await model.create({
            companyId: state.companyId, feature: 'ask', state: 'held', amountUsd: 0.8,
            model: 'gpt-4.1', provider: 'openai', taskClass: 'assist',
            estimatedInputTokens: 12, estimatedOutputTokens: 100000,
            actualInputTokens: null, actualOutputTokens: null, actualUsd: null,
            runId: 'run-1', userId: 'u1', at, settledAt: null, expiresAt: new Date(at.getTime() + 15 * MINUTE),
        });

        const stored = await rows.findOne({ _id: saved._id });
        expect(stored).toMatchObject({
            companyId: state.companyId, feature: 'ask', state: 'held', amountUsd: 0.8,
            model: 'gpt-4.1', provider: 'openai', taskClass: 'assist',
            estimatedInputTokens: 12, estimatedOutputTokens: 100000, runId: 'run-1', userId: 'u1',
        });

        await model.updateOne({ _id: saved._id, state: 'held' }, { $set: { state: 'settled', settledAt: new Date(), actualInputTokens: 1000, actualOutputTokens: 500, actualUsd: 0.006 } });
        expect(await rows.findOne({ _id: saved._id })).toMatchObject({ state: 'settled', actualInputTokens: 1000, actualOutputTokens: 500, actualUsd: 0.006 });
    });

    it('totals holds that are unsettled, unexpired and in this month, and nothing else', async () => {
        await rows.insertMany([
            hold({ amountUsd: 1 }),
            hold({ amountUsd: 2, state: 'settled' }),
            hold({ amountUsd: 4, expiresAt: new Date(Date.now() - MINUTE) }),
            hold({ amountUsd: 8, at: new Date(from.getTime() - MINUTE), expiresAt: new Date(Date.now() + MINUTE) }),
        ]);

        const [total] = await rows.aggregate(heldPipeline(new Date())).toArray();
        expect(total.usd).toBe(1);
    });

    it('gives the earlier of two racing holds the budget, through the id tie-break', async () => {
        const first = await rows.insertOne(hold({ amountUsd: 1 }));
        const second = await rows.insertOne(hold({ amountUsd: 1 }));
        const now = new Date();

        const [asFirst] = await rows.aggregate(heldPipeline(now, first.insertedId)).toArray();
        const [asSecond] = await rows.aggregate(heldPipeline(now, second.insertedId)).toArray();
        expect(asFirst.usd).toBe(1);
        expect(asSecond.usd).toBe(2);
    });
});

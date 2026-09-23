const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const purge = require('../../Modules/Knowledge/ingest/purge');

/* The purge's two writes, planned by a real server against the partial index the chunk schema
 * declares: a partial index is only chosen when the query provably falls inside its filter. */

const stagesOf = (plan) => {
    const found = [];
    const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (node.stage) found.push(node);
        ['inputStage', 'queryPlan'].forEach((key) => walk(node[key]));
        (node.inputStages || []).forEach(walk);
    };
    walk(plan);
    return found;
};

const keyed = (index) => JSON.stringify(index.key) === JSON.stringify(purge.INDEX_KEY);

describe('the tombstone purge reads its index', () => {
    let client;
    let db;
    let chunks;
    let indexName;
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    beforeAll(async () => {
        client = await MongoClient.connect(resolveMongoUrl());
        db = client.db(`f75_purge_${Date.now().toString(36)}`);
        chunks = db.collection('knowledge_chunks');
        await chunks.createIndex(purge.INDEX_KEY, purge.INDEX_OPTIONS);
        indexName = (await chunks.indexes()).find(keyed).name;
        const now = Date.now();
        await chunks.insertMany(Array.from({ length: 400 }, (_, i) => ({
            sourceType: 'page',
            sourceId: `s${i}`,
            ordinal: 0,
            deleted: i % 5 === 0,
            deletedAt: i % 5 === 0 ? new Date(now - i * 24 * 60 * 60 * 1000) : null,
            tombstoneReason: '',
        })));
    });

    afterAll(async () => {
        await db.dropDatabase();
        await client.close();
    });

    it('removes expired tombstones by an index scan of the partial index', async () => {
        const explained = await db.command({
            explain: { delete: 'knowledge_chunks', deletes: [{ q: purge.removableFilter(cutoff), limit: 0 }] },
            verbosity: 'queryPlanner',
        });
        const stages = stagesOf(explained.queryPlanner.winningPlan);
        expect(stages.map((s) => s.stage)).not.toContain('COLLSCAN');
        expect(stages.find((s) => s.stage === 'IXSCAN')).toMatchObject({ indexName });
    });

    it('empties expired markers by an index scan of the partial index', async () => {
        const explained = await db.command({
            explain: { update: 'knowledge_chunks', updates: [{ q: purge.blankableFilter(cutoff), u: { $set: purge.BLANK }, multi: true }] },
            verbosity: 'queryPlanner',
        });
        const stages = stagesOf(explained.queryPlanner.winningPlan);
        expect(stages.map((s) => s.stage)).not.toContain('COLLSCAN');
        expect(stages.find((s) => s.stage === 'IXSCAN')).toMatchObject({ indexName });
    });

    it('removes the expired plain tombstones and nothing else', async () => {
        const expired = await chunks.countDocuments({ deleted: true, deletedAt: { $lt: cutoff } });
        const result = await chunks.deleteMany(purge.removableFilter(cutoff));
        expect(result.deletedCount).toBe(expired);
        expect(await chunks.countDocuments({ deleted: false })).toBe(320);
    });
});

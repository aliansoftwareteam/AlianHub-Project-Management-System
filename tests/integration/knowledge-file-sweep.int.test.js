const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const sweep = require('../../Modules/Knowledge/ingest/fileSweep');

/* The file sweep's queries, run by a real server, against the partial index migration 032 builds:
 * a partial index is only chosen when the query provably falls inside its filter. */

const INDEX_NAME = 'sourceType_1_extractDueAt_1';

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

describe('the file sweep reads its index', () => {
    let client;
    let db;
    let chunks;

    beforeAll(async () => {
        client = await MongoClient.connect(resolveMongoUrl());
        db = client.db(`s7s4_sweep_${Date.now().toString(36)}`);
        chunks = db.collection('knowledge_chunks');
        await chunks.createIndex(sweep.INDEX_KEY, sweep.INDEX_OPTIONS);
        const now = Date.now();
        await chunks.insertMany(Array.from({ length: 400 }, (_, i) => ({
            sourceType: i % 2 ? 'file' : 'page',
            sourceId: `s${i}`,
            ordinal: 0,
            ...(i % 10 === 1 ? { extractDueAt: new Date(now - i * 1000) } : {}),
        })));
    });

    afterAll(async () => {
        await db.dropDatabase();
        await client.close();
    });

    it('finds the files due by an index scan of the partial index', async () => {
        const plan = await chunks.find(sweep.dueFilter(new Date())).sort(sweep.DUE_SORT).limit(20).explain('queryPlanner');
        const stages = stagesOf(plan.queryPlanner.winningPlan);
        expect(stages.map((s) => s.stage)).not.toContain('COLLSCAN');
        expect(stages.find((s) => s.stage === 'IXSCAN')).toMatchObject({ indexName: INDEX_NAME });
    });

    it('claims a due file by an index scan of the partial index', async () => {
        const now = new Date();
        const explained = await db.command({
            explain: { findAndModify: 'knowledge_chunks', query: { ...sweep.dueFilter(now), sourceId: { $nin: ['s1'] } }, sort: sweep.DUE_SORT, update: { $set: { extractDueAt: new Date(now.getTime() + 60000) } } },
            verbosity: 'queryPlanner',
        });
        const stages = stagesOf(explained.queryPlanner.winningPlan);
        expect(stages.map((s) => s.stage)).not.toContain('COLLSCAN');
        expect(stages.find((s) => s.stage === 'IXSCAN')).toMatchObject({ indexName: INDEX_NAME });
    });

    it('lists the owed files by an index scan of the partial index', async () => {
        const plan = await chunks.find(sweep.pendingFilter()).explain('queryPlanner');
        const stages = stagesOf(plan.queryPlanner.winningPlan);
        expect(stages.map((s) => s.stage)).not.toContain('COLLSCAN');
        expect(stages.find((s) => s.stage === 'IXSCAN')).toMatchObject({ indexName: INDEX_NAME });
    });
});

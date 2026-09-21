const { MongoClient, ObjectId } = require('mongodb');
const { loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { resolveMongoUrl } = require('../../e2e/support/env');

/* Sprint 7 slice 10 at the API: the instance owner reads a workspace's knowledge figures from the
 * real aggregation (stored sizes included), re-indexes a source without it leaving retrieval, and
 * erases a page with the confirmation typed back; members and workspace admins are refused. */

const state = readState();
const DEADLINE_MS = 60000;
const BASE = '/api/v2/instance/knowledge';

jest.setTimeout(150000);

const poll = async (check, deadlineMs = DEADLINE_MS) => {
    const deadline = Date.now() + deadlineMs;
    let value = await check();
    while (!value && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        value = await check();
    }
    return value;
};

describe('the instance knowledge console', () => {
    let client;
    let companies;
    let tenant;
    let owner;
    let word;
    let pageId;

    const setIndexer = (mode) => companies.updateOne(
        { _id: new ObjectId(state.companyId) },
        mode ? { $set: { knowledgeIndexer: { mode } } } : { $unset: { knowledgeIndexer: '' } },
    );
    const figures = async () => {
        const res = await owner.api.get(`${BASE}/${state.companyId}?refresh=1`);
        expect(res.status).toBe(200);
        return res.body.data;
    };
    const pageFigures = async () => (await figures()).sources.find((s) => s.sourceType === 'page');

    beforeAll(async () => {
        client = await MongoClient.connect(resolveMongoUrl());
        companies = client.db('global').collection('companies');
        tenant = client.db(state.companyId);
        owner = await loginAs('owner');
        await setIndexer('on');
        word = `kc${uniqueSuffix()}${Date.now().toString(36)}`;
        const res = await owner.api.post('/api/v2/pages', {
            title: `[QA knowledge console] ${word}`, visibility: 'project', projectId: state.projects.shared._id, contentBlocks: [{ type: 'paragraph', data: { text: `The console names ${word}.` } }],
        });
        expect(res.body.status).toBe(true);
        pageId = String(res.body.data._id);
        const built = await poll(async () => (await tenant.collection('knowledge_chunks').countDocuments({ sourceType: 'page', sourceId: pageId, deleted: false })) > 0
            && (await tenant.collection('knowledge_index_state').countDocuments({ sourceType: 'page', status: 'complete' })) === 1);
        expect(built).toBe(true);
    });

    afterAll(async () => {
        if (companies) await setIndexer(null);
        if (client) await client.close();
    });

    it.each(['admin', 'member'])('refuses a workspace %s', async (role) => {
        const session = await loginAs(role);
        expect((await session.api.get(BASE)).status).toBe(403);
        expect((await session.api.get(`${BASE}/${state.companyId}`)).status).toBe(403);
        expect((await session.api.post(`${BASE}/${state.companyId}/erase/document`, { sourceType: 'page', sourceId: pageId, confirm: pageId })).status).toBe(403);
        expect(await tenant.collection('knowledge_chunks').countDocuments({ sourceId: pageId })).toBeGreaterThan(0);
    });

    it('lists the workspace with its modes', async () => {
        const res = await owner.api.get(`${BASE}?pageSize=100`);
        expect(res.status).toBe(200);
        const row = res.body.data.workspaces.find((w) => w.companyId === state.companyId);
        expect(row).toMatchObject({ modes: { indexer: 'on' } });
        expect(row.sources.find((s) => s.sourceType === 'page')).toMatchObject({ backfill: 'complete' });
    });

    it('reads the figures from the real aggregation, stored sizes included, and never the text', async () => {
        const data = await figures();
        expect(data.cachedAt).toEqual(expect.any(String));
        const page = data.sources.find((s) => s.sourceType === 'page');
        expect(page.chunks).toBeGreaterThan(0);
        expect(page.sources).toBeGreaterThan(0);
        expect(page.textBytes).toBeGreaterThan(0);
        expect(page.backfill.status).toBe('complete');
        expect(data.totals.textBytes).toBeGreaterThanOrEqual(page.textBytes);
        expect(JSON.stringify(data)).not.toContain(word);
    });

    it('re-indexes pages while they stay complete and readable', async () => {
        const res = await owner.api.post(`${BASE}/${state.companyId}/reindex`, { sourceType: 'page' });
        expect(res.status).toBe(202);
        const done = await poll(async () => {
            const row = await tenant.collection('knowledge_index_state').findOne({ sourceType: 'page' });
            expect(row.status).toBe('complete');
            return row.reindexStatus === 'complete' && row;
        });
        expect(done).toBeTruthy();
        expect((await pageFigures()).chunks).toBeGreaterThan(0);
        expect(await tenant.collection('knowledge_chunks').countDocuments({ sourceType: 'page', sourceId: pageId, deleted: false })).toBeGreaterThan(0);
    });

    it('erases the page only with its id typed back, and audits who did it with counts', async () => {
        const wrong = await owner.api.post(`${BASE}/${state.companyId}/erase/document`, { sourceType: 'page', sourceId: pageId, confirm: 'yes' });
        expect(wrong.status).toBe(400);
        expect(wrong.body.code).toBe('confirmation_mismatch');
        expect(await tenant.collection('knowledge_chunks').countDocuments({ sourceId: pageId })).toBeGreaterThan(0);

        const res = await owner.api.post(`${BASE}/${state.companyId}/erase/document`, { sourceType: 'page', sourceId: pageId, confirm: pageId });
        expect(res.status).toBe(200);
        expect(res.body.data.total).toBeGreaterThan(0);
        expect(await tenant.collection('knowledge_chunks').countDocuments({ sourceId: pageId })).toBe(0);
        expect(await tenant.collection('knowledge_exclusions').countDocuments({ kind: 'document', sourceType: 'page', sourceId: pageId })).toBe(1);

        const audit = await poll(() => tenant.collection('audit_logs').findOne({ action: 'knowledge.erase_document', entityId: pageId }));
        expect(audit).toMatchObject({ actorId: String(owner.userId), entityType: 'page', meta: { sourceType: 'page', removed: { page: res.body.data.total }, total: res.body.data.total } });
        expect(JSON.stringify(audit)).not.toContain(word);
    });

    it('lists the exclusion the erasure wrote, with who and how many chunks', async () => {
        const res = await owner.api.get(`${BASE}/${state.companyId}/exclusions`);
        expect(res.status).toBe(200);
        expect(res.body.data.exclusions).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'document', sourceType: 'page', sourceId: pageId, erasedBy: String(owner.userId), erasedChunks: expect.any(Number) }),
        ]));
    });

    it('explains the figures aggregation: an index scan on source type, then a fetch of each chunk', async () => {
        const { figuresPipeline } = require('../../Modules/Knowledge/figuresPipeline');
        const chunks = tenant.collection('knowledge_chunks');
        const types = await chunks.distinct('sourceType');
        const plan = JSON.stringify(await chunks.aggregate(figuresPipeline(types, ['extract:failed'], 3)).explain('queryPlanner'));
        expect(plan).toMatch(/IXSCAN/);
        expect(plan).toMatch(/FETCH/);
        expect(plan).not.toMatch(/COLLSCAN/);
    });
});

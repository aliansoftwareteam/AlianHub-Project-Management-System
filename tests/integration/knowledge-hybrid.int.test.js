const { MongoClient, ObjectId } = require('mongodb');
const { loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { resolveMongoUrl } = require('../../e2e/support/env');

/* Sprint 7 slice 6 at the API: with the harness company in hybrid mode and the embeddings
 * endpoint answered by the harness stub, a page is embedded as it is indexed, a question is
 * embedded once and answered with fused sources, and the private-page and deleted-page rules
 * still hold. The instance key is set through the instance settings for this suite only and
 * removed again afterwards, so every other suite still runs with no model configured. */

const state = readState();
const DEADLINE_MS = 60000;
const MODEL = 'text-embedding-3-small';
const PARAGRAPH = 'Routine paragraph about the weekly operations rota and nothing else.';

jest.setTimeout(150000);

const token = () => `kh${uniqueSuffix()}${Date.now().toString(36)}`;

const ask = async (session, question) => {
    const res = await session.api.post('/api/v1/ai/ask', { question });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe(true);
    return res.body.data;
};
const sourceIds = async (session, question) => (await ask(session, question)).sources.map((s) => String(s.id));

const poll = async (check, deadlineMs = DEADLINE_MS) => {
    const deadline = Date.now() + deadlineMs;
    let value = await check();
    while (!value && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        value = await check();
    }
    return value;
};

const createPage = async (session, { title, body, visibility, projectId }) => {
    const res = await session.api.post('/api/v2/pages', { title, visibility, ...(projectId ? { projectId } : {}), contentBlocks: [{ type: 'paragraph', data: { text: body } }] });
    expect(res.body.status).toBe(true);
    return String(res.body.data._id);
};

const createLongPage = async (session, { word, visibility, projectId }) => {
    const res = await session.api.post('/api/v2/pages', {
        title: `[QA knowledge hybrid] ${visibility} ${uniqueSuffix()}`,
        visibility,
        projectId,
        contentBlocks: [
            ...Array.from({ length: 120 }, () => ({ type: 'paragraph', data: { text: PARAGRAPH } })),
            { type: 'header', data: { text: 'Appendix', level: 2 } },
            { type: 'paragraph', data: { text: `The appendix names ${word}.` } },
        ],
    });
    expect(res.body.status).toBe(true);
    return String(res.body.data._id);
};

describe('hybrid retrieval with embeddings from the instance key', () => {
    let client;
    let companies;
    let tenant;
    let owner;

    const setModes = (retrieval) => companies.updateOne(
        { _id: new ObjectId(state.companyId) },
        retrieval ? { $set: { knowledgeRetrieval: { mode: retrieval }, knowledgeIndexer: { mode: 'on' } } } : { $unset: { knowledgeRetrieval: '', knowledgeIndexer: '' } },
    );
    const setKey = async (value) => {
        const res = await owner.api.put('/api/v2/instance/settings', { AI_API_KEY: value });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
    };
    const liveChunks = (pageId) => tenant.collection('knowledge_chunks').find({ sourceType: 'page', sourceId: pageId, deleted: false }).toArray();
    const embedRows = (where = {}) => tenant.collection('ai_usage').find({ feature: 'knowledge_embed', ...where }).toArray();
    const found = (session, word, id) => poll(async () => (await sourceIds(session, word)).includes(id));
    const gone = (session, word, id) => poll(async () => !(await sourceIds(session, word)).includes(id));

    beforeAll(async () => {
        expect(state.embeddingsUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1\/embeddings$/);
        client = await MongoClient.connect(resolveMongoUrl());
        companies = client.db('global').collection('companies');
        tenant = client.db(state.companyId);
        owner = await loginAs('owner');
        await setModes('hybrid');
        await setKey('e2e-embeddings-stub');

        await createPage(owner, { title: `[QA knowledge hybrid] warm-up ${uniqueSuffix()}`, body: 'Starts the backfill.', visibility: 'project', projectId: state.projects.shared._id });
        const built = await poll(async () => (await tenant.collection('knowledge_index_state')
            .countDocuments({ sourceType: { $in: ['page', 'comment', 'transcript'] }, status: 'complete' })) === 3);
        expect(built).toBe(true);
    });

    afterAll(async () => {
        if (owner) await setKey('');
        if (companies) await setModes(null);
        if (client) await client.close();
    });

    it('embeds a page as it is indexed, answers a question from it, and books the query embedding once per question to the asker', async () => {
        const member = await loginAs('member');
        const word = token();
        const since = new Date();
        const pageId = await createLongPage(owner, { word, visibility: 'project', projectId: state.projects.shared._id });

        const chunks = await poll(async () => {
            const rows = await liveChunks(pageId);
            return rows.length > 0 && rows.every((c) => c.embeddingModel === MODEL && Array.isArray(c.embedding) && c.embedding.length > 0) && rows;
        });
        expect(chunks).toBeTruthy();
        expect(chunks.some((c) => c.text.includes(word))).toBe(true);
        expect(await embedRows({ userId: null, at: { $gte: since } })).not.toHaveLength(0);

        const before = (await embedRows({ userId: member.uid })).length;
        expect(await found(member, word, pageId)).toBe(true);
        const between = (await embedRows({ userId: member.uid })).length;
        expect(between).toBeGreaterThan(before);

        expect(await sourceIds(member, word)).toContain(pageId);
        const after = await embedRows({ userId: member.uid });
        expect(after).toHaveLength(between + 1);
        after.slice(between).forEach((row) => expect(row).toMatchObject({ companyId: state.companyId, provider: 'openai', model: MODEL, outputTokens: 0, priced: true, billedToWorkspace: true }));
    });

    it('answers from a private page for its owner and never for a member', async () => {
        const member = await loginAs('member');
        const word = token();
        const pageId = await createLongPage(owner, { word, visibility: 'private', projectId: state.projects.shared._id });

        expect(await found(owner, word, pageId)).toBe(true);
        expect((await liveChunks(pageId)).every((c) => c.embeddingModel === MODEL)).toBe(true);
        expect(await sourceIds(member, word)).not.toContain(pageId);
    });

    it('drops a deleted page within a minute and tombstones its chunks, vectors included', async () => {
        const word = token();
        const pageId = await createLongPage(owner, { word, visibility: 'project', projectId: state.projects.shared._id });
        expect(await found(owner, word, pageId)).toBe(true);

        const removed = await owner.api.delete(`/api/v2/pages/${pageId}`);
        expect(removed.body.status).toBe(true);

        expect(await gone(owner, word, pageId)).toBe(true);
        expect(await poll(async () => (await liveChunks(pageId)).length === 0)).toBe(true);
    });

    it('computes no query embedding once the company is back in "on" mode', async () => {
        const member = await loginAs('member');
        const word = token();
        const pageId = await createPage(owner, { title: `[QA knowledge hybrid] lexical ${uniqueSuffix()}`, body: `Only words: ${word}.`, visibility: 'project', projectId: state.projects.shared._id });
        await setModes('on');
        try {
            const before = (await embedRows({ userId: member.uid })).length;
            expect(await found(member, word, pageId)).toBe(true);
            expect(await embedRows({ userId: member.uid })).toHaveLength(before);
        } finally {
            await setModes('hybrid');
        }
    });
});

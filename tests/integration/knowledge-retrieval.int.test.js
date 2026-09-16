const { MongoClient, ObjectId } = require('mongodb');
const { loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { resolveMongoUrl } = require('../../e2e/support/env');

/* Sprint 7 exit gate, at the API: a private page reaches its owner's answers and nobody
 * else's, and a deleted page leaves them within a minute. The server runs with
 * KNOWLEDGE_RETRIEVAL=tenant, so only this company's own switch turns retrieval on. */

const state = readState();
const DELETE_DEADLINE_MS = 60000;

jest.setTimeout(120000);

const token = () => `kr${uniqueSuffix()}${Date.now().toString(36)}`;

const ask = async (session, question) => {
    const res = await session.api.post('/api/v1/ai/ask', { question });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe(true);
    return res.body.data;
};

const sourceIds = async (session, question) => (await ask(session, question)).sources.map((s) => String(s.id));

const createPage = async (session, { title, body, visibility, projectId }) => {
    const res = await session.api.post('/api/v2/pages', {
        title,
        visibility,
        ...(projectId ? { projectId } : {}),
        contentBlocks: [{ type: 'paragraph', data: { text: body } }],
    });
    expect(res.body.status).toBe(true);
    return String(res.body.data._id);
};

describe('knowledge retrieval behind the tenant switch', () => {
    let client;
    let companies;

    const setMode = (mode) => companies.updateOne(
        { _id: new ObjectId(state.companyId) },
        mode ? { $set: { knowledgeRetrieval: { mode } } } : { $unset: { knowledgeRetrieval: '' } },
    );

    beforeAll(async () => {
        client = await MongoClient.connect(resolveMongoUrl());
        companies = client.db('global').collection('companies');
        await setMode('on');
    });

    afterAll(async () => {
        await setMode(null);
        await client.close();
    });

    it('still returns sources when no model is configured, and finds words in a page body', async () => {
        const owner = await loginAs('owner');
        const word = token();
        const pageId = await createPage(owner, { title: `[QA knowledge] shared ${uniqueSuffix()}`, body: `The launch checklist mentions ${word}.`, visibility: 'project', projectId: state.projects.shared._id });

        const data = await ask(owner, `Where is ${word} written down?`);
        expect(data.configured).toBe(false);
        expect(data.sources.map((s) => String(s.id))).toContain(pageId);
        expect(data.sources.find((s) => String(s.id) === pageId)).toMatchObject({ kind: 'page', permission: { visibility: 'project', via: 'project' } });
    });

    it('answers from a private page for its owner and never for a member', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const word = token();
        const pageId = await createPage(owner, { title: `[QA knowledge] private ${uniqueSuffix()}`, body: `Salary notes: ${word}.`, visibility: 'private', projectId: state.projects.shared._id });

        expect(await sourceIds(owner, word)).toContain(pageId);
        expect(await sourceIds(member, word)).not.toContain(pageId);
    });

    it('reaches a company-wide page with no project for a member', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const word = token();
        const pageId = await createPage(owner, { title: `[QA knowledge] handbook ${uniqueSuffix()}`, body: `Holiday policy ${word}.`, visibility: 'project' });

        expect(await sourceIds(member, word)).toContain(pageId);
    });

    it('returns a call transcript to the people on the call and to nobody else', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const admin = await loginAs('admin');
        const word = token();
        const saved = await owner.api.post('/api/v2/calls/notes', {
            callId: `s7s1-${uniqueSuffix()}`,
            title: '[QA knowledge] call',
            participants: [member.uid],
            transcript: `We agreed the ${word} rollout.`,
            durationSec: 60,
        });
        expect(saved.body.status).toBe(true);
        const callId = String(saved.body.data._id);

        expect(await sourceIds(owner, word)).toContain(callId);
        expect(await sourceIds(member, word)).toContain(callId);
        expect(await sourceIds(admin, word)).not.toContain(callId);
    });

    it('drops a deleted page from the owner\'s sources within a minute', async () => {
        const owner = await loginAs('owner');
        const word = token();
        const pageId = await createPage(owner, { title: `[QA knowledge] doomed ${uniqueSuffix()}`, body: `Retired plan ${word}.`, visibility: 'private', projectId: state.projects.shared._id });
        expect(await sourceIds(owner, word)).toContain(pageId);

        const removed = await owner.api.delete(`/api/v2/pages/${pageId}`);
        expect(removed.body.status).toBe(true);

        const deadline = Date.now() + DELETE_DEADLINE_MS;
        let ids = await sourceIds(owner, word);
        while (ids.includes(pageId) && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            ids = await sourceIds(owner, word);
        }
        expect(ids).not.toContain(pageId);
    });

    it('searches as it did before once the company switch is off: page titles only', async () => {
        const owner = await loginAs('owner');
        const word = token();
        const pageId = await createPage(owner, { title: `[QA knowledge] body only ${uniqueSuffix()}`, body: `Only the body says ${word}.`, visibility: 'project', projectId: state.projects.shared._id });
        expect(await sourceIds(owner, word)).toContain(pageId);

        await setMode(null);
        try {
            const data = await ask(owner, word);
            expect(data.sources.map((s) => String(s.id))).not.toContain(pageId);
            data.sources.forEach((s) => expect(s.permission).toBeUndefined());
        } finally {
            await setMode('on');
        }
    });
});

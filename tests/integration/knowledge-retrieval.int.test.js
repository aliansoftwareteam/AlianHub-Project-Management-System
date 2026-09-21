const { MongoClient, ObjectId } = require('mongodb');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
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

/* With the indexer on, page passages come from the chunk store the event bus keeps. A word
 * placed past the 5,000 characters a page row keeps in rawText can only be found through a
 * chunk, so finding it proves retrieval read the index. */
describe('knowledge retrieval reading the page index', () => {
    const PARAGRAPH = 'Routine paragraph about the weekly operations rota and nothing else.';

    let client;
    let companies;
    let tenant;

    const setSwitches = (on) => companies.updateOne(
        { _id: new ObjectId(state.companyId) },
        on ? { $set: { knowledgeRetrieval: { mode: 'on' }, knowledgeIndexer: { mode: 'on' } } } : { $unset: { knowledgeRetrieval: '', knowledgeIndexer: '' } },
    );

    const poll = async (check, deadlineMs = DELETE_DEADLINE_MS) => {
        const deadline = Date.now() + deadlineMs;
        let value = await check();
        while (!value && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            value = await check();
        }
        return value;
    };

    const createLongPage = async (session, { word, visibility, projectId }) => {
        const res = await session.api.post('/api/v2/pages', {
            title: `[QA knowledge index] ${visibility} ${uniqueSuffix()}`,
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

    const liveSourceChunks = (sourceType, sourceId) => tenant.collection('knowledge_chunks').find({ sourceType, sourceId, deleted: false }).toArray();
    const liveChunks = (pageId) => liveSourceChunks('page', pageId);
    const found = (session, word, id) => poll(async () => (await sourceIds(session, word)).includes(id));
    const gone = (session, word, id) => poll(async () => !(await sourceIds(session, word)).includes(id));

    beforeAll(async () => {
        client = await MongoClient.connect(resolveMongoUrl());
        companies = client.db('global').collection('companies');
        tenant = client.db(state.companyId);
        await setSwitches(true);

        const owner = await loginAs('owner');
        await createPage(owner, { title: `[QA knowledge index] warm-up ${uniqueSuffix()}`, body: 'Starts the backfill.', visibility: 'project', projectId: state.projects.shared._id });
        const built = await poll(async () => (await tenant.collection('knowledge_index_state')
            .countDocuments({ sourceType: { $in: ['page', 'comment', 'transcript', 'guide', 'file'] }, status: 'complete' })) === 5);
        expect(built).toBe(true);
    });

    afterAll(async () => {
        await setSwitches(false);
        await client.close();
    });

    it('ingests a created page and finds a word only its chunks carry', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const word = token();
        const pageId = await createLongPage(owner, { word, visibility: 'project', projectId: state.projects.shared._id });

        const chunks = await poll(async () => { const rows = await liveChunks(pageId); return rows.some((c) => c.text.includes(word)) && rows; });
        expect(chunks).toBeTruthy();
        expect(chunks[0]).toMatchObject({ companyId: state.companyId, visibility: 'project', authorKind: 'human', embeddingModel: null });
        const stored = await tenant.collection('pages').findOne({ _id: new ObjectId(pageId) });
        expect(stored.rawText).not.toContain(word);

        expect(await poll(async () => (await sourceIds(member, word)).includes(pageId))).toBe(true);
    });

    it('answers from a private page for its owner and never for a member', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const word = token();
        const pageId = await createLongPage(owner, { word, visibility: 'private', projectId: state.projects.shared._id });

        expect(await poll(async () => (await sourceIds(owner, word)).includes(pageId))).toBe(true);
        expect(await sourceIds(member, word)).not.toContain(pageId);
    });

    it('drops a deleted page within a minute and tombstones its chunks', async () => {
        const owner = await loginAs('owner');
        const word = token();
        const pageId = await createLongPage(owner, { word, visibility: 'project', projectId: state.projects.shared._id });
        expect(await poll(async () => (await sourceIds(owner, word)).includes(pageId))).toBe(true);

        const removed = await owner.api.delete(`/api/v2/pages/${pageId}`);
        expect(removed.body.status).toBe(true);

        expect(await poll(async () => !(await sourceIds(owner, word)).includes(pageId))).toBe(true);
        expect(await poll(async () => (await liveChunks(pageId)).length === 0)).toBe(true);
    });

    it('answers from a comment for someone who can open its task, never for someone who cannot, and drops it within a minute of its deletion', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const word = token();
        const project = await createProject(owner.api, { name: `[QA knowledge index] vault ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });
        const task = await createTask(owner.api, { project, name: `[QA knowledge index] vault task ${uniqueSuffix()}`, user: state.users.owner, companyOwnerId: owner.uid });
        const saved = await owner.api.post('/api/v1/comments', {
            data: { message: `The vault code is ${word}.`, type: 'text', project: false, taskId: task._id, projectId: project._id, sprintId: task.sprintId },
        });
        expect(saved.body.status).toBe(true);
        const commentId = String(saved.body.data._id);

        expect(await poll(async () => (await liveSourceChunks('comment', commentId)).length > 0)).toBe(true);
        const [chunk] = await liveSourceChunks('comment', commentId);
        expect(chunk).toMatchObject({ companyId: state.companyId, visibility: 'project', taskId: task._id, createdBy: owner.uid, authorKind: 'human' });
        expect(String(chunk.projectId)).toBe(String(project._id));

        expect(await found(owner, word, commentId)).toBe(true);
        expect(await sourceIds(member, word)).not.toContain(commentId);

        const removed = await owner.api.put('/api/v1/comments', { id: commentId, data: { isDeleted: true } });
        expect(removed.body.status).toBe(true);
        expect(await gone(owner, word, commentId)).toBe(true);
        expect(await poll(async () => (await liveSourceChunks('comment', commentId)).length === 0)).toBe(true);
    });

    it('answers from call notes for the people on the call and not for an admin, and drops them within a minute of being discarded', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const admin = await loginAs('admin');
        const word = token();
        const saved = await owner.api.post('/api/v2/calls/notes', {
            callId: `s7s3-${uniqueSuffix()}`,
            title: '[QA knowledge index] call',
            participants: [member.uid],
            transcript: `We agreed the ${word} rollout.`,
            durationSec: 60,
        });
        expect(saved.body.status).toBe(true);
        const callId = String(saved.body.data._id);

        expect(await poll(async () => (await liveSourceChunks('transcript', callId)).length > 0)).toBe(true);
        const [chunk] = await liveSourceChunks('transcript', callId);
        expect(chunk).toMatchObject({ companyId: state.companyId, visibility: 'participants' });
        expect([...chunk.participants].sort()).toEqual([owner.uid, member.uid].sort());

        expect(await found(owner, word, callId)).toBe(true);
        expect(await sourceIds(member, word)).toContain(callId);
        expect(await sourceIds(admin, word)).not.toContain(callId);

        const discarded = await owner.api.patch(`/api/v2/calls/notes/${callId}`, { status: 'discarded' });
        expect(discarded.body.status).toBe(true);
        expect(await gone(member, word, callId)).toBe(true);
        expect(await poll(async () => (await liveSourceChunks('transcript', callId)).length === 0)).toBe(true);
    });

    it('answers from a private workspace page for its author only, not an admin, from a company-wide one for everyone, and drops a deleted one within a minute', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const admin = await loginAs('admin');
        const word = token();
        const privateId = await createPage(member, { title: `[QA knowledge index] workspace private ${uniqueSuffix()}`, body: `Locker ${word} holds my notes.`, visibility: 'private' });
        const sharedId = await createPage(owner, { title: `[QA knowledge index] workspace handbook ${uniqueSuffix()}`, body: `Locker ${word} holds the life jackets.`, visibility: 'project' });

        expect(await poll(async () => (await liveChunks(privateId)).length > 0 && (await liveChunks(sharedId)).length > 0)).toBe(true);
        (await liveChunks(privateId)).forEach((chunk) => expect(chunk).toMatchObject({ projectId: null, visibility: 'private', createdBy: member.uid }));
        (await liveChunks(sharedId)).forEach((chunk) => expect(chunk).toMatchObject({ projectId: null, visibility: 'project' }));

        expect(await found(member, word, privateId)).toBe(true);
        expect(await found(admin, word, sharedId)).toBe(true);
        expect(await sourceIds(member, word)).toContain(sharedId);
        expect(await sourceIds(admin, word)).not.toContain(privateId);
        expect(await sourceIds(owner, word)).not.toContain(privateId);

        const removed = await owner.api.delete(`/api/v2/pages/${sharedId}`);
        expect(removed.body.status).toBe(true);
        expect(await gone(member, word, sharedId)).toBe(true);
        expect(await poll(async () => (await liveChunks(sharedId)).length === 0)).toBe(true);
    });

    it('answers from the text of an attachment for someone who can open its task, never for someone who cannot, and drops it within a minute of its removal', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const word = token();
        const project = await createProject(owner.api, { name: `[QA knowledge index] files ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });
        const task = await createTask(owner.api, { project, name: `[QA knowledge index] file task ${uniqueSuffix()}`, user: state.users.owner, companyOwnerId: owner.uid });

        const key = `Project/${project._id}/Sprint/${task._id}/Attachment/${Date.now()}_handover.txt`;
        const form = new FormData();
        form.append('companyId', state.companyId);
        form.append('path', key);
        form.append('file', new Blob([`Handover notes.\nThe safe combination is ${word}.`]), 'handover.txt');
        const uploaded = await fetch(new URL('/api/v1/storage/uploadFile', state.baseURL), { method: 'POST', headers: { authorization: `Bearer ${owner.accessToken}` }, body: form });
        expect(uploaded.status).toBe(200);
        expect((await uploaded.json()).statusText).toBe(key);

        const record = { id: `qa${uniqueSuffix()}`.replace(/[^A-Za-z0-9]/g, '').slice(0, 17), filename: 'handover.txt', extension: 'txt', size: 64, type: 'text', userId: owner.uid, createdAt: new Date().toISOString(), url: key };
        const attachmentBody = (operation) => ({
            action: 'updateAttachments', companyId: state.companyId, sprintId: task.sprintId, taskId: task._id,
            taskData: { _id: task._id, TaskName: task.TaskName, sprintId: task.sprintId, ProjectID: project._id, attachments: [] },
            id: record.id, operation, data: record, userData: { id: owner.uid, Employee_Name: 'Owner', companyOwnerId: owner.uid }, projectData: { id: project._id, ProjectName: project.ProjectName },
        });
        const attached = await owner.api.patch('/api/v2/tasks', attachmentBody('add'));
        expect(attached.body.status).toBe(true);

        const sourceId = `${task._id}:${record.id}`;
        expect(await poll(async () => (await liveSourceChunks('file', sourceId)).length > 0)).toBe(true);
        const [chunk] = await liveSourceChunks('file', sourceId);
        expect(chunk).toMatchObject({ companyId: state.companyId, visibility: 'project', taskId: task._id, title: 'handover.txt', origin: 'member', fileKey: key, pieceCount: 1 });
        expect(String(chunk.projectId)).toBe(String(project._id));
        expect(chunk.text).toContain(word);

        expect(await found(owner, word, sourceId)).toBe(true);
        const source = (await ask(owner, word)).sources.find((s) => String(s.id) === sourceId);
        expect(source).toMatchObject({ kind: 'file', taskId: task._id, origin: 'member', permission: { visibility: 'project', via: 'task' } });
        expect(await sourceIds(member, word)).not.toContain(sourceId);

        const detached = await owner.api.patch('/api/v2/tasks', attachmentBody('remove'));
        expect(detached.body.status).toBe(true);
        expect(await gone(owner, word, sourceId)).toBe(true);
        expect(await poll(async () => (await liveSourceChunks('file', sourceId)).length === 0)).toBe(true);
    });

    it('answers from a project guide for someone who can open the project and never for someone who cannot', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const word = token();
        const project = await createProject(owner.api, { name: `[QA knowledge index] guided ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });

        const saved = await owner.api.put(`/api/v1/project/${project._id}`, { updateObject: { aiGuide: { stages: [], markdown: `## Stages\n1. Commission the ${word} pump` } } });
        expect(saved.status).toBe(200);

        const projectId = String(project._id);
        expect(await poll(async () => (await liveSourceChunks('guide', projectId)).length > 0)).toBe(true);
        (await liveSourceChunks('guide', projectId)).forEach((chunk) => expect(chunk).toMatchObject({ companyId: state.companyId, visibility: 'project', authorKind: 'agent', origin: 'agent' }));

        expect(await found(owner, word, projectId)).toBe(true);
        expect((await ask(owner, word)).sources.find((s) => String(s.id) === projectId)).toMatchObject({ kind: 'guide', origin: 'agent', permission: { visibility: 'project', via: 'project' } });
        expect(await sourceIds(member, word)).not.toContain(projectId);
    });
});

/* Sprint 7 slice 8, in process against the harness database: an agent's note goes through the
 * LangGraph store, the memory event, the chunk store and its text index, and comes back to that
 * agent's own run and to no other agent's. The harness server keeps KNOWLEDGE_AGENT_MEMORY off. */
describe('agent memory in the knowledge store', () => {
    const MEMORY_ENV = ['NODE_ENV', 'MONGODB_URL', 'KNOWLEDGE_INDEXER', 'KNOWLEDGE_AGENT_MEMORY', 'KNOWLEDGE_FLAG_CACHE_TTL_SECONDS'];
    const saved = Object.fromEntries(MEMORY_ENV.map((key) => [key, process.env[key]]));

    let client;
    let companies;
    let tenant;
    let owner;
    let modules;
    const own = new ObjectId();
    const other = new ObjectId();
    const runIds = [];

    const recall = (agentId, word) => modules.retrieval.retrieve({
        companyId: state.companyId,
        caller: { kind: 'agent', userId: owner.uid, agentId: String(agentId), runId: String(new ObjectId()) },
        query: word,
        scope: { sourceTypes: ['memory'] },
    }).then((result) => result.passages.map((p) => p.sourceId));

    beforeAll(async () => {
        // The LangGraph store refuses a real database under NODE_ENV=test, a guard meant for the unit suites.
        Object.assign(process.env, { NODE_ENV: 'integration', MONGODB_URL: resolveMongoUrl(), KNOWLEDGE_INDEXER: 'tenant', KNOWLEDGE_AGENT_MEMORY: 'on', KNOWLEDGE_FLAG_CACHE_TTL_SECONDS: '0' });
        client = await MongoClient.connect(resolveMongoUrl());
        companies = client.db('global').collection('companies');
        tenant = client.db(state.companyId);
        await companies.updateOne({ _id: new ObjectId(state.companyId) }, { $set: { knowledgeIndexer: { mode: 'on' } } });
        await tenant.collection('agents').insertMany([
            { _id: own, name: '[QA memory] scribe', projectIds: [String(state.projects.shared._id)], deletedStatusKey: 0 },
            { _id: other, name: '[QA memory] planner', projectIds: [String(state.projects.shared._id)], deletedStatusKey: 0 },
        ]);
        owner = await loginAs('owner');
        modules = {
            memory: require('../../Modules/Agents/memory'),
            persistence: require('../../Modules/AICore/persistence'),
            events: require('../../Modules/Knowledge/memory/events'),
            backfill: require('../../Modules/Knowledge/memory/backfill'),
            retrieval: require('../../Modules/Knowledge/retrieval'),
            connections: require('../../middlewares/mongoConnector/helper'),
        };
        modules.events.start();
    });

    afterAll(async () => {
        modules.events.stop();
        await tenant.collection('agents').deleteMany({ _id: { $in: [own, other] } });
        await tenant.collection('agent_runs').deleteMany({ _id: { $in: runIds } });
        await tenant.collection('knowledge_chunks').deleteMany({ sourceType: 'memory', agentId: { $in: [String(own), String(other)] } });
        await tenant.collection('agent_memory').deleteMany({ namespace: { $in: [String(own), String(other)] } });
        await tenant.collection('knowledge_index_state').deleteOne({ sourceType: 'memory' });
        await companies.updateOne({ _id: new ObjectId(state.companyId) }, { $unset: { knowledgeIndexer: '' } });
        await modules.persistence.close();
        modules.connections.closeConnection(state.companyId);
        modules.connections.closeConnection('global');
        await client.close();
        MEMORY_ENV.forEach((key) => { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; });
    });

    it("recalls an agent's own note in its own run, and never in another agent's", async () => {
        const word = token();
        const run = { _id: new ObjectId(), agentId: String(own), startedBy: owner.uid, projectId: String(state.projects.shared._id), status: 'running' };
        await tenant.collection('agent_runs').insertOne(run);
        runIds.push(run._id);
        const note = await modules.memory.rememberForAgent({ companyId: state.companyId, runId: String(run._id), text: `The berth code is ${word}.` });
        await modules.events.drain();
        expect(await modules.backfill.backfill(state.companyId)).toMatchObject({ status: 'complete' });

        const [chunk] = await tenant.collection('knowledge_chunks').find({ sourceType: 'memory', sourceId: note.memoryId, deleted: false }).toArray();
        expect(chunk).toMatchObject({ scope: 'agent', agentId: String(own), projectIds: [String(state.projects.shared._id)], authorKind: 'agent', tainted: false });

        expect(await recall(own, word)).toEqual([note.memoryId]);
        expect(await recall(other, word)).toEqual([]);
    });
});

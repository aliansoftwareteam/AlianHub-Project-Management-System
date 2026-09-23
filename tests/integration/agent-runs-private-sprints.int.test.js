const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, createTask, firstSprint, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();

jest.setTimeout(90000);

const sessions = {};
const as = async (role) => {
    if (!sessions[role]) sessions[role] = await loginAs(role);
    return sessions[role];
};

async function projectWithTask(owner, assignees) {
    const project = await createProject(owner.api, { assigneeIds: assignees.map((s) => s.uid), createdBy: owner.uid });
    let lastErr;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            const task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid });
            return { project, task };
        } catch (err) {
            lastErr = err;
            await new Promise((resolve) => setTimeout(resolve, 300));
        }
    }
    throw lastErr;
}

async function makeSprintPrivate(owner, { project }, assigneeIds) {
    const sprint = await firstSprint(owner.api, project._id);
    const res = await owner.api.patch(`/api/v1/sprint/${sprint._id}`, {
        type: 'updateSprint',
        companyId: state.companyId,
        projectId: String(project._id),
        updateObject: { $set: { private: true, AssigneeUserId: assigneeIds.map(String) } },
    });
    expect(res.body.status).toBe(true);
}

async function createAgent(owner, projectIds) {
    const res = await owner.api.post('/api/v2/agents', {
        name: `[QA arps] ${uniqueSuffix()}`, description: 'private sprint reads', autonomy: 1, spendCapUsd: 1,
        projectIds: projectIds.map(String), skills: [], allowedActions: ['task.comment'],
    });
    if (res.status !== 200 || !res.body.status) throw new Error(`create agent failed (${res.status}): ${JSON.stringify(res.body)}`);
    return res.body.data;
}

/* A run needs a live model to reach waiting_approval, so the rows are written the way runs.start and proposals.create leave them. */
async function seed(agent, { task }, { startedAt }) {
    const client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    try {
        await client.connect();
        const db = client.db(state.companyId);
        const common = { agentId: String(agent._id), agentName: agent.name, taskId: String(task._id), projectId: String(task.projectId) };
        const run = await db.collection('agent_runs').insertOne({
            ...common, status: 'waiting_approval', trigger: 'manual', startedBy: state.users.owner.userId, startedAt, createdAt: startedAt, updatedAt: startedAt, steps: [],
        });
        const what = `[QA arps] proposal ${uniqueSuffix()}`;
        const proposal = await db.collection('agent_proposals').insertOne({
            ...common, runId: String(run.insertedId), what, why: 'integration', status: 'pending', changes: [], createdAt: startedAt, updatedAt: startedAt,
        });
        return { runId: String(run.insertedId), proposalId: String(proposal.insertedId), what };
    } finally {
        await client.close();
    }
}

const runIds = (res) => (res.body.data || []).map((r) => String(r._id));
const proposalIds = (res) => (res.body.data || []).map((p) => String(p._id));

async function readsOf(session, agent) {
    const [runs, byAgent, summary, proposals, pageOfRuns, pageOfProposals] = await Promise.all([
        session.api.get('/api/v2/agents/runs', { query: { limit: 200 } }),
        session.api.get('/api/v2/agents/runs', { query: { agentId: String(agent._id), limit: 200 } }),
        session.api.get('/api/v2/agents/runs/summary', { query: { agentId: String(agent._id) } }),
        session.api.get('/api/v2/agents/proposals', { query: { status: 'all', limit: 500 } }),
        session.api.get('/api/v2/agents/runs', { query: { agentId: String(agent._id), limit: 1 } }),
        session.api.get('/api/v2/agents/proposals', { query: { status: 'all', agentId: String(agent._id), limit: 1 } }),
    ]);
    [runs, byAgent, summary, proposals, pageOfRuns, pageOfProposals].forEach((res) => expect(res.status).toBe(200));
    return { runs, byAgent, summary, proposals, pageOfRuns, pageOfProposals };
}

describe('agent runs and proposals follow private sprint visibility', () => {
    let owner; let admin; let member;
    let agent; let open; let hidden; let shared;
    let openSeed; let hiddenSeed; let sharedSeed;
    let before;

    beforeAll(async () => {
        owner = await as('owner');
        admin = await as('admin');
        member = await as('member');
        open = await projectWithTask(owner, [owner, admin, member]);
        hidden = await projectWithTask(owner, [owner, admin, member]);
        shared = await projectWithTask(owner, [owner, admin, member]);
        agent = await createAgent(owner, [open.project._id, hidden.project._id, shared.project._id]);

        openSeed = await seed(agent, open, { startedAt: new Date(Date.now() - 60000) });
        before = {
            member: await readsOf(member, agent),
            admin: await readsOf(admin, agent),
        };
        await makeSprintPrivate(owner, hidden, [owner.uid]);
        await makeSprintPrivate(owner, shared, [owner.uid, member.uid]);
        hiddenSeed = await seed(agent, hidden, { startedAt: new Date() });
    });

    it('leaves a run on a private sprint task out of a non-member\'s run list and counts', async () => {
        const after = await readsOf(member, agent);
        expect(runIds(after.runs)).toContain(openSeed.runId);
        expect(runIds(after.runs)).not.toContain(hiddenSeed.runId);
        expect(runIds(after.byAgent)).toEqual([openSeed.runId]);
        expect(after.runs.body.summary.runs.map((r) => String(r._id))).not.toContain(hiddenSeed.runId);
        expect(after.runs.body.summary.waitingApproval).toBe(before.member.runs.body.summary.waitingApproval);
        expect(after.runs.body.summary.agents).toBe(before.member.runs.body.summary.agents);
        expect(after.summary.body.data.counts.waiting_approval).toBe(1);
        expect(after.summary.body.data.waitingApproval).toBe(before.member.summary.body.data.waitingApproval);
    });

    it('fills a page of runs from what the caller can see', async () => {
        const after = await readsOf(member, agent);
        expect(runIds(after.pageOfRuns)).toEqual([openSeed.runId]);
    });

    it('answers GET /runs/:id for such a run like a run that does not exist', async () => {
        const res = await member.api.get(`/api/v2/agents/runs/${hiddenSeed.runId}`);
        const missing = await member.api.get('/api/v2/agents/runs/0123456789abcdef01234567');
        expect(res.status).toBe(404);
        expect(res.body).toEqual(missing.body);
        expect((await member.api.get(`/api/v2/agents/runs/${openSeed.runId}`)).status).toBe(200);
    });

    it('leaves a proposal on a private sprint task out of a non-member\'s inbox and counts', async () => {
        const after = await readsOf(member, agent);
        expect(proposalIds(after.proposals)).toContain(openSeed.proposalId);
        expect(proposalIds(after.proposals)).not.toContain(hiddenSeed.proposalId);
        expect(JSON.stringify(after.proposals.body)).not.toContain(hiddenSeed.what);
        expect(after.proposals.body.counts).toEqual(before.member.proposals.body.counts);
        expect(proposalIds(after.pageOfProposals)).toEqual([openSeed.proposalId]);
    });

    it('shows a sprint member the runs and proposals on its tasks', async () => {
        sharedSeed = await seed(agent, shared, { startedAt: new Date() });
        const after = await readsOf(member, agent);
        expect(runIds(after.byAgent)).toEqual(expect.arrayContaining([sharedSeed.runId, openSeed.runId]));
        expect(runIds(after.byAgent)).not.toContain(hiddenSeed.runId);
        expect(runIds(after.pageOfRuns)).toEqual([sharedSeed.runId]);
        expect(proposalIds(after.proposals)).toContain(sharedSeed.proposalId);
        expect(after.proposals.body.counts.waiting).toBe(before.member.proposals.body.counts.waiting + 1);
        expect(after.summary.body.data.counts.waiting_approval).toBe(2);
        expect((await member.api.get(`/api/v2/agents/runs/${sharedSeed.runId}`)).status).toBe(200);
    });

    it('leaves owners and admins who are not on the sprint unchanged', async () => {
        for (const session of [owner, admin]) {
            const after = await readsOf(session, agent);
            const expected = [openSeed.runId, hiddenSeed.runId, sharedSeed.runId];
            expect(runIds(after.byAgent)).toEqual(expect.arrayContaining(expected));
            expect(after.summary.body.data.counts.waiting_approval).toBe(3);
            expect(proposalIds(after.proposals)).toEqual(expect.arrayContaining([openSeed.proposalId, hiddenSeed.proposalId, sharedSeed.proposalId]));
            expect((await session.api.get(`/api/v2/agents/runs/${hiddenSeed.runId}`)).status).toBe(200);
        }
        const adminAfter = await readsOf(admin, agent);
        expect(adminAfter.proposals.body.counts.waiting).toBe(before.admin.proposals.body.counts.waiting + 2);
    });
});

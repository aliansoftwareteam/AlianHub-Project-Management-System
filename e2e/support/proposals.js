const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('./env');
const { uniqueSuffix } = require('./fixtures');

/* An agent only the test uses, so a proposal filed under its name can be approved. */
async function createAgent(api, { project, name }) {
    const res = await api.post('/api/v2/agents', {
        name,
        description: 'playwright agent',
        autonomy: 1,
        spendCapUsd: 1,
        projectIds: [String(project._id)],
        skills: [],
        allowedActions: ['task.comment'],
    });
    if (res.status !== 200 || !res.body.status) throw new Error(`create agent ${name} failed (${res.status}): ${JSON.stringify(res.body).slice(0, 300)}`);
    return res.body.data;
}

/* Waiting proposals written the way tests/inbox-proposals.test.js seeds them: one row in agent_proposals,
 * which the Inbox queue and the approve and decline calls then read. */
async function openProposals(state) {
    const client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    const collection = client.db(state.companyId).collection('agent_proposals');
    const runs = client.db(state.companyId).collection('agent_runs');
    const seeded = [];
    const seededRuns = [];
    return {
        /* `runBy` files it from a run that person started, which makes it their own agent's proposal. */
        async seed({ agent, project, task, what, why, runBy }) {
            const _id = new ObjectId();
            const now = new Date();
            let runId = null;
            if (runBy) {
                runId = new ObjectId();
                await runs.insertOne({ _id: runId, agentId: String(agent._id), startedBy: String(runBy), status: 'done', createdAt: now, updatedAt: now });
                seededRuns.push(runId);
            }
            await collection.insertOne({
                _id,
                agentId: String(agent._id),
                agentName: agent.name,
                runId: runId && String(runId),
                what,
                why,
                changes: [{ action: 'task.comment', params: { taskId: String(task._id), body: `Looks good ${uniqueSuffix()}` }, label: 'Comment on the task', reversible: true }],
                status: 'pending',
                gate: null,
                taskId: String(task._id),
                projectId: String(project._id),
                createdAt: now,
                updatedAt: now,
            });
            seeded.push(_id);
            return String(_id);
        },
        async statusOf(id) {
            const row = await collection.findOne({ _id: new ObjectId(id) }, { projection: { status: 1 } });
            return row && row.status;
        },
        async close() {
            if (seeded.length) await collection.deleteMany({ _id: { $in: seeded } });
            if (seededRuns.length) await runs.deleteMany({ _id: { $in: seededRuns } });
            await client.close();
        },
    };
}

module.exports = { createAgent, openProposals };

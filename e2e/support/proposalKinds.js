const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('./env');

const PLAN = {
    statuses: ['In Review'],
    lists: ['Backlog', 'This week'],
    definitions: [{ name: 'Budget', type: 'money' }, { name: 'Region', type: 'dropdown', options: ['North', 'South'] }],
    views: [{ name: 'Review board', kind: 'board', look: { groupBy: 'status', statuses: ['In Review'] }, showFields: ['Budget'] }],
};

/* The token a connected AI files under: approving checks that it is still live and the requester's own. */
async function createToken(api, name) {
    const res = await api.post('/api/v2/api-tokens/mcp', { name });
    if (res.status !== 200 || !res.body.status) throw new Error(`create token failed (${res.status}): ${JSON.stringify(res.body).slice(0, 300)}`);
    const data = res.body.data;
    return String(data._id || data.id);
}

/* One waiting proposal of each kind a connected AI files, written the way the server tests build them:
 * tests/mcp-project-setup.test.js, mcp-project-create.test.js, mcp-automation-proposal.test.js and mcp-batch-waits.test.js. */
async function openKinds(state) {
    const client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    const collection = client.db(state.companyId).collection('agent_proposals');
    const tokens = client.db(state.companyId).collection('apiTokens');
    const seeded = [];

    async function insert({ agent, project, requestedBy, tokenId, what, why, changes }) {
        // Setup, project and automation changes are filed under the manage grant, which approval asks the token again.
        if (tokenId) await tokens.updateOne({ _id: new ObjectId(String(tokenId)) }, { $addToSet: { grants: 'tasks:manage' } });
        const _id = new ObjectId();
        const now = new Date();
        await collection.insertOne({
            _id,
            agentId: String(agent._id),
            agentName: agent.name,
            runId: null,
            source: 'mcp',
            requestedBy: String(requestedBy),
            tokenId: String(tokenId || ''),
            tokenProjectIds: [],
            allowedActions: [],
            what,
            why,
            changes,
            status: 'pending',
            gate: null,
            projectId: String(project._id),
            createdAt: now,
            updatedAt: now,
        });
        seeded.push(_id);
        return String(_id);
    }

    return {
        PLAN,
        seedSetup({ agent, project, requestedBy, tokenId, why }) {
            const params = { projectId: String(project._id), ...PLAN };
            return insert({ agent, project, requestedBy, tokenId, what: 'Set up the project', why, changes: [{ action: 'project.setup', params, label: 'Set up the project', reversible: true }] });
        },
        seedProject({ agent, project, requestedBy, tokenId, why, name, description }) {
            const params = { name, description, ...PLAN };
            return insert({ agent, project, requestedBy, tokenId, what: 'Create a project', why, changes: [{ action: 'project.create', params, label: 'Create a project', reversible: true }] });
        },
        seedAutomation({ agent, project, requestedBy, tokenId, why, message }) {
            const params = {
                projectId: String(project._id),
                trigger: 'task.status_changed',
                conditions: [{ field: 'statusRef', op: 'changedTo', value: 'Done' }],
                actions: [{ action: 'notify', config: { recipients: ['task_assignees'], message } }],
                enabled: false,
            };
            return insert({ agent, project, requestedBy, tokenId, what: 'Add an automation', why, changes: [{ action: 'automation.create', params, label: 'Add an automation', reversible: true }] });
        },
        seedBatch({ agent, project, tasks, requestedBy, tokenId, why, status }) {
            const changes = tasks.map((task) => ({
                action: 'task.status.change',
                params: { taskId: String(task._id), status: { name: status } },
                label: 'Change the status',
                reversible: true,
            }));
            return insert({ agent, project, requestedBy, tokenId, what: `Move ${tasks.length} tasks`, why, changes });
        },
        async statusOf(id) {
            const row = await collection.findOne({ _id: new ObjectId(id) }, { projection: { status: 1 } });
            return row && row.status;
        },
        async close() {
            if (seeded.length) await collection.deleteMany({ _id: { $in: seeded } });
            await client.close();
        },
    };
}

module.exports = { createToken, openKinds };

const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('./env');

const MCP = 'mcp';

/* Waiting proposals a connected AI filed, written the way tests/mcp-batch-waits.test.js and tests/mcp-project-setup.test.js
 * read them back: source 'mcp', one change for a project plan, several on named tasks for a batch. */
async function openCards(state) {
    const client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    const collection = client.db(state.companyId).collection('agent_proposals');
    const seeded = [];

    async function insert({ agent, project, requestedBy, what, why, changes }) {
        const _id = new ObjectId();
        const now = new Date();
        await collection.insertOne({
            _id,
            agentId: String(agent._id),
            agentName: agent.name,
            runId: null,
            source: MCP,
            requestedBy: String(requestedBy),
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
        seedBatch({ agent, project, tasks, requestedBy, why, status }) {
            const changes = tasks.map((task) => ({
                action: 'task.status.change',
                params: { taskId: String(task._id), status: { name: status } },
                label: 'Change the status',
                reversible: true,
            }));
            return insert({ agent, project, requestedBy, what: `Move ${tasks.length} tasks`, why, changes });
        },
        seedSetup({ agent, project, requestedBy, why }) {
            const params = {
                projectId: String(project._id),
                statuses: ['In Review'],
                lists: ['Backlog', 'This week'],
                definitions: [{ name: 'Budget', type: 'money' }, { name: 'Region', type: 'dropdown', options: ['North', 'South'] }],
                views: [{ name: 'Review board', kind: 'board', look: { groupBy: 'status', statuses: ['In Review'] }, showFields: ['Budget'] }],
            };
            return insert({ agent, project, requestedBy, what: 'Set up the project', why, changes: [{ action: 'project.setup', params, label: 'Set up the project', reversible: true }] });
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

module.exports = { openCards };

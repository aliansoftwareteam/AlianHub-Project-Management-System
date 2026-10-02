const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('./env');

const PLAN = {
    statuses: ['In Review'],
    lists: ['Backlog', 'This week'],
    definitions: [{ name: 'Budget', type: 'money' }, { name: 'Region', type: 'dropdown', options: ['North', 'South'] }],
    views: [{ name: 'Review board', kind: 'board', look: { groupBy: 'status', statuses: ['In Review'] }, showFields: ['Budget'] }],
};

/* One waiting proposal of each kind a connected AI files, written the way the server tests build them:
 * tests/mcp-project-setup.test.js, mcp-project-create.test.js, mcp-automation-proposal.test.js and mcp-batch-waits.test.js. */
async function openKinds(state) {
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
            source: 'mcp',
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
        PLAN,
        seedSetup({ agent, project, requestedBy, why }) {
            const params = { projectId: String(project._id), ...PLAN };
            return insert({ agent, project, requestedBy, what: 'Set up the project', why, changes: [{ action: 'project.setup', params, label: 'Set up the project', reversible: true }] });
        },
        seedProject({ agent, project, requestedBy, why, name, description }) {
            const params = { name, description, ...PLAN };
            return insert({ agent, project, requestedBy, what: 'Create a project', why, changes: [{ action: 'project.create', params, label: 'Create a project', reversible: true }] });
        },
        seedAutomation({ agent, project, requestedBy, why, message }) {
            const params = {
                projectId: String(project._id),
                trigger: 'task.status_changed',
                conditions: [{ field: 'statusRef', op: 'changedTo', value: 'Done' }],
                actions: [{ action: 'notify', config: { recipients: ['task_assignees'], message } }],
                enabled: false,
            };
            return insert({ agent, project, requestedBy, what: 'Add an automation', why, changes: [{ action: 'automation.create', params, label: 'Add an automation', reversible: true }] });
        },
        seedBatch({ agent, project, tasks, requestedBy, why, status }) {
            const changes = tasks.map((task) => ({
                action: 'task.status.change',
                params: { taskId: String(task._id), status: { name: status } },
                label: 'Change the status',
                reversible: true,
            }));
            return insert({ agent, project, requestedBy, what: `Move ${tasks.length} tasks`, why, changes });
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

module.exports = { openKinds };

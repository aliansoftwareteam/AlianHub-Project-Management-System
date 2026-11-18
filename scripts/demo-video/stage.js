const { execFile } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createToken } = require('../../e2e/support/proposalKinds');
const { makeAgent } = require('./seed');

const ROOT = path.resolve(__dirname, '..', '..');
const ENC_KEY = 'demo-video-only-not-a-secret-0001';
const REPO = 'northwind-studio/website';

/* The child gets the shell's search path and home and nothing else of this process's environment. */
const shellBasics = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => ['PATH', 'HOME'].includes(name)));

async function withDb(companyId, use) {
    const client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    try {
        return await use(client.db(companyId));
    } finally {
        await client.close();
    }
}

const projectNamed = (companyId, name) => withDb(companyId, (db) => db.collection('projects').findOne({ ProjectName: name }, { projection: { _id: 1, ProjectCode: 1 } }));

const taskNamed = (companyId, projectId, name) => withDb(companyId, (db) => db.collection('tasks').findOne(
    { ProjectID: new ObjectId(String(projectId)), TaskName: name, deletedStatusKey: 0 }, { projection: { _id: 1, TaskKey: 1, sprintId: 1 } },
));

/* A proposal from the person's connected AI, filed the way e2e/support/proposalKinds.js files one. */
async function fileFieldProposal(world, { project, what, why, fields }) {
    if (!world.connectedAi) {
        const tokenId = await createToken(world.owner.api, 'Claude');
        const agent = await makeAgent(world.owner.api, { project: world.project, name: 'Claude', description: 'Maya\'s own Claude, connected over MCP. Every change it asks for waits here.' });
        world.connectedAi = { tokenId, agent };
    }
    const { tokenId, agent } = world.connectedAi;
    return withDb(world.companyId, async (db) => {
        await db.collection('apiTokens').updateOne({ _id: new ObjectId(String(tokenId)) }, { $addToSet: { grants: 'tasks:manage' } });
        const now = new Date();
        const _id = new ObjectId();
        await db.collection('agent_proposals').insertOne({
            _id, agentId: String(agent._id), agentName: agent.name, runId: null, source: 'mcp', requestedBy: String(world.owner.userId), tokenId: String(tokenId),
            tokenProjectIds: [], allowedActions: [], what, why,
            changes: [{ action: 'fields.create', params: { projectId: String(project._id), definitions: fields }, label: 'Add custom fields to a project', reversible: true }],
            status: 'pending', gate: null, projectId: String(project._id), createdAt: now, updatedAt: now,
        });
        return String(_id);
    });
}

/* One pull request event through the app's own GitHub sync, in a child process (see githubPullRequest.js). */
function playPullRequest(world, { project, task, number, merged }) {
    const at = new Date();
    const pull = {
        number, title: `${task.TaskKey} Build pricing page`, html_url: `https://github.com/${REPO}/pull/${number}`, user: { login: 'sofia-rossi' },
        state: merged ? 'closed' : 'open', updated_at: at.toISOString(), merged_at: merged ? at.toISOString() : null,
        merge_commit_sha: merged ? '4f2c9a1d8e7b6c5a4f3e2d1c0b9a8f7e6d5c4b3a' : null, head: { ref: `feature/${task.TaskKey}-pricing-page` }, body: 'Three plans and a comparison table.',
    };
    const request = { companyId: world.companyId, projectId: String(project._id), connectedBy: world.owner.userId, repo: REPO, pull };
    return new Promise((resolve, reject) => {
        execFile(process.execPath, ['-r', path.join(ROOT, 'e2e', 'support', 'ignore-dotenv.js'), path.join(__dirname, 'githubPullRequest.js'), JSON.stringify(request)], {
            cwd: ROOT,
            env: {
                ...shellBasics(), TMPDIR: os.tmpdir(), NODE_ENV: 'development',
                MONGODB_URL: resolveMongoUrl(), CLOUD_STORAGE_ENC_KEY: ENC_KEY, APP_CONNECTIONS: 'on', LOG_DIR: path.join(os.tmpdir(), 'demo-video-sync-log'),
            },
        }, (error, stdout, stderr) => {
            if (error) return reject(new Error(`pull request sync failed: ${stderr || error.message}`));
            const line = stdout.trim().split('\n').pop();
            const result = JSON.parse(line);
            if (!result.acted) return reject(new Error(`pull request sync acted on nothing: ${line}`));
            return resolve(result);
        });
    });
}

module.exports = { ENC_KEY, withDb, projectNamed, taskNamed, fileFieldProposal, playPullRequest };

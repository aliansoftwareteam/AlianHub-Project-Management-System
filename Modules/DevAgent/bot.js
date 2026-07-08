const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { removeCache } = require("../../utils/commonFunctions");
const logger = require("../../Config/loggerConfig");

// The "AI Bot" is a normal global user with a fixed email, made assignable in a
// company via a company_users membership (marked status:3 — hidden from the Members
// list, which filters status !== 3, but still assignable in the task picker, which
// filters only isDelete === false). Assigning it to a task enqueues a
// Development-chat job (see the hook in Tasks/helpers/taskMongo/updateAssignment.js),
// which the same runner pipeline (pending → claim → develop → reply) then handles.
// The repo comes from the runner's local config.repos — nothing is persisted here.
const BOT_EMAIL = 'ai-bot@alianhub.local';
// Default avatar for the AI Bot — a self-contained SVG data URI stored in the
// user's Employee_profileImageURL, so it renders everywhere that field is shown
// (assignee picker, task chips, comments, …) with no uploaded file or external
// dependency. A navy circle with a little white robot head.
const BOT_AVATAR = `data:image/svg+xml;base64,${Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#2f3a8f"/><rect x="30" y="12" width="4" height="7" rx="2" fill="#c7ccf2"/><circle cx="32" cy="11" r="3" fill="#c7ccf2"/><rect x="17" y="20" width="30" height="24" rx="7" fill="#ffffff"/><circle cx="26" cy="31" r="3.6" fill="#2f3a8f"/><circle cx="38" cy="31" r="3.6" fill="#2f3a8f"/><rect x="27" y="37" width="10" height="3" rx="1.5" fill="#8b93e0"/></svg>',
).toString('base64')}`;
let cachedBotId = '';

async function getBotUserId() {
    if (cachedBotId) return cachedBotId;
    try {
        const u = await MongoDbCrudOpration('global', { type: SCHEMA_TYPE.USERS, data: [{ Employee_Email: BOT_EMAIL }] }, 'findOne');
        cachedBotId = u ? String(u._id) : '';
    } catch (e) { cachedBotId = ''; }
    return cachedBotId;
}

// Idempotent: find-or-create the global bot user + this company's membership.
async function ensureBotUser(companyId) {
    let u = await MongoDbCrudOpration('global', { type: SCHEMA_TYPE.USERS, data: [{ Employee_Email: BOT_EMAIL }] }, 'findOne');
    if (!u) {
        u = await MongoDbCrudOpration('global', {
            type: SCHEMA_TYPE.USERS,
            data: { Employee_FName: 'AI', Employee_LName: 'Bot', Employee_Name: 'AI Bot', Employee_Email: BOT_EMAIL, Employee_profileImageURL: BOT_AVATAR, isEmailVerified: true, isActive: true, AssignCompany: [String(companyId)] },
        }, 'save');
    } else {
        // Link this company so the bot appears in the members / assignee-picker
        // profile store (frontend fetches global users by AssignCompany).
        await MongoDbCrudOpration('global', {
            type: SCHEMA_TYPE.USERS,
            data: [{ _id: String(u._id) }, { $addToSet: { AssignCompany: String(companyId) }, $set: { Employee_profileImageURL: BOT_AVATAR } }, {}],
        }, 'updateOne');
    }
    const botUserId = String(u._id);
    cachedBotId = botUserId;

    // The bot needs a company_users membership to be assignable (the task assignee
    // picker is company_users-driven — a store-only user can't appear in it). We keep
    // it OUT of the Members module by marking it status:3 — the Members list filters
    // status !== 3, while the assignee picker filters only isDelete === false. So:
    // status:3 = hidden from Members (always); isDelete = the enable/disable toggle.
    const existing = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMPANY_USERS, data: [{ userId: botUserId }] }, 'findOne');
    if (!existing) {
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: { companyId: String(companyId), userId: botUserId, userEmail: BOT_EMAIL, roleType: 3, status: 3, designation: 0, isDelete: false },
        }, 'save');
    } else {
        // (Re)enable + keep it hidden from Members (also migrates an older status:2 row).
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [{ userId: botUserId }, { $set: { isDelete: false, status: 3 } }, {}],
        }, 'updateOne');
    }
    removeCache(`company_users:${companyId}`); // refresh the assignee picker right away
    return { botUserId, name: 'AI Bot' };
}

// Enable/disable is PER-USER and lives on the client (a local flag → the assignee
// picker shows the bot only for developers who turned it on; see the frontend
// composable useAiBot). Nothing per-user is stored here, so there is no server-side
// disable — the shared membership just stays assignable-eligible (isDelete:false).

// Enqueue a Development-chat instruction for a task. The repo is resolved from
// the task's chat history (the newest message that carried one). If the task has
// NO repo yet, we do NOT queue a job that would just fail — instead the bot posts
// a short prompt asking the developer to set the repo; once they enter it and
// send a message, the normal flow develops the task. Keeps "just assign the bot"
// friendly for any developer, with no repo persistence.
async function enqueueForTask(companyId, taskData, projectData) {
    const taskId = String(taskData._id);
    const projectId = String(projectData._id || taskData.ProjectID || '');
    const sprintId = String(taskData.sprintId || '');
    const botUserId = await getBotUserId();

    // The last repo used on this task, if any (newest message with a real repo).
    const priorRows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.DEV_MESSAGES,
        data: [{ taskId, repo: { $nin: ['', null] } }, null, { sort: { createdAt: -1 }, limit: 1 }],
    }, 'find').catch(() => []);
    const prior = (priorRows || [])[0];
    const repo = prior && prior.repo ? String(prior.repo).trim() : '';
    const base = prior && prior.base ? String(prior.base).trim() : 'main';

    if (!repo) {
        // No repository set for this task yet — prompt (as the bot) instead of
        // queuing a job that would only error. The developer sets the repo and
        // sends, and the normal chat flow takes over from there.
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DEV_MESSAGES,
            data: {
                taskId, projectId, sprintId, role: 'agent',
                text: "👋 I'm assigned to this task, but no repository is set yet. Enter the repo (git URL or local path) in the box above and send me a message — then I'll start implementing.",
                userId: botUserId,
            },
        }, 'save');
        return;
    }

    const desc = taskData.description || taskData.rawDescription || '';
    const text = `Implement this task: ${taskData.TaskName || ''}${desc ? `\n\n${desc}` : ''}`.trim();
    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.DEV_MESSAGES,
        data: {
            taskId, projectId, sprintId,
            role: 'user', text, repo, base, status: 'pending',
            userId: botUserId,
        },
    }, 'save');
}

// Called from the assignment hook — enqueue only when the AI Bot itself was added.
async function onAssigneeAdded(companyId, addedUserId, taskData, projectData) {
    try {
        const botUserId = await getBotUserId();
        if (botUserId && String(addedUserId) === botUserId) await enqueueForTask(companyId, taskData, projectData);
    } catch (e) { logger.error(`ERROR in dev-agent onAssigneeAdded: ${e.message}`); }
}

module.exports = { BOT_EMAIL, getBotUserId, ensureBotUser, enqueueForTask, onAssigneeAdded };

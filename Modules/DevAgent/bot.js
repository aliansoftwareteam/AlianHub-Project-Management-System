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
            data: { Employee_FName: 'AI', Employee_LName: 'Bot', Employee_Name: 'AI Bot', Employee_Email: BOT_EMAIL, isEmailVerified: true, isActive: true, AssignCompany: [String(companyId)] },
        }, 'save');
    } else {
        // Link this company so the bot appears in the members / assignee-picker
        // profile store (frontend fetches global users by AssignCompany).
        await MongoDbCrudOpration('global', {
            type: SCHEMA_TYPE.USERS,
            data: [{ _id: String(u._id) }, { $addToSet: { AssignCompany: String(companyId) } }, {}],
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

// Is the AI Bot currently enabled (assignable) in this company? Enabled === its
// company_users membership exists and isn't soft-deleted.
async function getBotStatus(companyId) {
    const botUserId = await getBotUserId();
    if (!botUserId) return { enabled: false };
    const m = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMPANY_USERS, data: [{ userId: botUserId }] }, 'findOne');
    return { enabled: !!(m && m.isDelete !== true) };
}

// Disable the bot: soft-delete its company_users membership so it drops out of the
// assignee picker (Assignee.vue filters isDelete === false). Fully reversible via
// ensureBotUser. The global user + its AssignCompany stay, so tasks already assigned
// to the bot still resolve its name — nothing is hard-deleted.
async function disableBotUser(companyId) {
    const botUserId = await getBotUserId();
    if (botUserId) {
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [{ userId: botUserId }, { $set: { isDelete: true, status: 3 } }, {}],
        }, 'updateOne');
        removeCache(`company_users:${companyId}`);
    }
    return { botUserId: botUserId || '', enabled: false };
}

// Enqueue a Development-chat instruction for a task (repo left blank → the runner
// resolves it from its local config.repos).
async function enqueueForTask(companyId, taskData, projectData) {
    const desc = taskData.description || taskData.rawDescription || '';
    const text = `Implement this task: ${taskData.TaskName || ''}${desc ? `\n\n${desc}` : ''}`.trim();
    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.DEV_MESSAGES,
        data: {
            taskId: String(taskData._id),
            projectId: String(projectData._id || taskData.ProjectID || ''),
            sprintId: String(taskData.sprintId || ''),
            role: 'user', text, repo: '', base: 'main', status: 'pending',
            userId: await getBotUserId(),
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

module.exports = { BOT_EMAIL, getBotUserId, ensureBotUser, enqueueForTask, onAssigneeAdded, getBotStatus, disableBotUser };

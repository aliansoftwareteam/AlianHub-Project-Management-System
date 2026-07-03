// AHE-3792 — AI Brain persistence layer.
//
// The Brain's 3 collections (settings, audit, inbox) live in the GLOBAL db,
// each row scoped by a `companyId` field — NOT in per-company DBs. Per-company
// DBs can hit MongoDB's hard 500-collections-per-db cap (a company at the cap
// can't create the new collections → the whole feature 500s). Keeping them
// global means 3 collections total for the whole instance.
//
// Every function here is companyId-scoped: callers pass companyId and never
// touch the db directly, so a company can only ever read/write its own rows.

const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const mongoose = require('mongoose');

const DB = SCHEMA_TYPE.GOLBAL;
const oid = (id) => new mongoose.Types.ObjectId(String(id));

// ── Settings (singleton per company: {companyId, key:'default'}) ──
async function getSettingsDoc(companyId) {
    const row = await MongoDbCrudOpration(DB, {
        type: SCHEMA_TYPE.AI_BRAIN_SETTINGS,
        data: [{ companyId: String(companyId), key: 'default' }, {}],
    }, 'findOne').catch(() => null);
    return row && (row.toObject ? row.toObject() : row);
}

async function upsertSettings(companyId, set) {
    return MongoDbCrudOpration(DB, {
        type: SCHEMA_TYPE.AI_BRAIN_SETTINGS,
        data: [
            { companyId: String(companyId), key: 'default' },
            { $set: { ...set, companyId: String(companyId), key: 'default' } },
            { new: true, upsert: true, setDefaultsOnInsert: true },
        ],
    }, 'findOneAndUpdate');
}

// Phase B — bind a project to its code repo ("work location"). Stored on the
// settings singleton under repos.<projectId> so the dev runner can resolve it.
async function setProjectRepo(companyId, projectId, repo) {
    return MongoDbCrudOpration(DB, {
        type: SCHEMA_TYPE.AI_BRAIN_SETTINGS,
        data: [
            { companyId: String(companyId), key: 'default' },
            { $set: { [`repos.${projectId}`]: repo, companyId: String(companyId), key: 'default' } },
            { new: true, upsert: true, setDefaultsOnInsert: true },
        ],
    }, 'findOneAndUpdate');
}

// ── Audit (append-only) ──
async function writeAudit(companyId, entry) {
    try {
        return await MongoDbCrudOpration(DB, {
            type: SCHEMA_TYPE.AI_AUDIT_LOG,
            data: { ...entry, companyId: String(companyId) },
        }, 'save');
    } catch (e) {
        logger.error(`AIBrain writeAudit error: ${e && e.message ? e.message : e}`);
        return null;
    }
}

async function listAudit(companyId, filter = {}, limit = 50, skip = 0) {
    return MongoDbCrudOpration(DB, {
        type: SCHEMA_TYPE.AI_AUDIT_LOG,
        data: [{ ...filter, companyId: String(companyId) }, null, { sort: { createdAt: -1 }, limit, skip }],
    }, 'find').catch(() => []);
}

async function countExecutedToday(companyId) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const rows = await MongoDbCrudOpration(DB, {
        type: SCHEMA_TYPE.AI_AUDIT_LOG,
        data: [{ companyId: String(companyId), status: 'executed', createdAt: { $gte: start } }, { _id: 1 }],
    }, 'find').catch(() => []);
    return (rows || []).length;
}

// ── Inbox (approval queue) ──
async function createInboxItem(companyId, item) {
    return MongoDbCrudOpration(DB, {
        type: SCHEMA_TYPE.AI_INBOX,
        data: { ...item, companyId: String(companyId), status: 'pending' },
    }, 'save');
}

async function listInbox(companyId, filter = {}, limit = 100) {
    return MongoDbCrudOpration(DB, {
        type: SCHEMA_TYPE.AI_INBOX,
        data: [{ ...filter, companyId: String(companyId) }, null, { sort: { createdAt: -1 }, limit }],
    }, 'find').catch(() => []);
}

async function findInboxItem(companyId, id) {
    if (!mongoose.Types.ObjectId.isValid(String(id))) return null;
    return MongoDbCrudOpration(DB, {
        type: SCHEMA_TYPE.AI_INBOX,
        data: [{ _id: oid(id), companyId: String(companyId) }, {}],
    }, 'findOne').catch(() => null);
}

async function updateInboxItem(companyId, id, set) {
    return MongoDbCrudOpration(DB, {
        type: SCHEMA_TYPE.AI_INBOX,
        data: [{ _id: oid(id), companyId: String(companyId) }, { $set: set }, { new: true }],
    }, 'findOneAndUpdate');
}

async function pendingInboxKeys(companyId, projectId) {
    const rows = await MongoDbCrudOpration(DB, {
        type: SCHEMA_TYPE.AI_INBOX,
        data: [{ companyId: String(companyId), projectId: String(projectId), status: 'pending', deletedStatusKey: { $in: [0, null] } }, { taskId: 1, actionKey: 1 }],
    }, 'find').catch(() => []);
    return new Set((rows || []).map((r) => `${r.taskId}|${r.actionKey}`));
}

// `${taskId}|${actionKey}` keys the agent has already SURFACED for a project
// recently — proposed (queued), executed (auto-run or approved) or declined
// (rejected) within the window. A re-scan skips these so it never re-proposes
// or re-runs the same action on the same task and spams duplicate comments.
// Reads the AUDIT log (not the inbox) because auto-run actions (L2+) are audited
// but never enter the inbox. 'failed'/'blocked' are excluded so a genuinely
// failed action can be retried; after the window the agent may surface it again
// (e.g. a task still stale a week later).
const DEDUP_WINDOW_DAYS = 7;
async function handledActionKeys(companyId, projectId, windowDays = DEDUP_WINDOW_DAYS) {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const rows = await MongoDbCrudOpration(DB, {
        type: SCHEMA_TYPE.AI_AUDIT_LOG,
        data: [{
            companyId: String(companyId),
            projectId: String(projectId),
            status: { $in: ['proposed', 'executed', 'declined'] },
            createdAt: { $gte: since },
        }, { taskId: 1, actionKey: 1 }],
    }, 'find').catch(() => []);
    return new Set((rows || []).map((r) => `${r.taskId}|${r.actionKey}`));
}

// Dev jobs = approved develop_task inbox items the runner works on
// (queued → running → done/failed).
async function listDevJobs(companyId, statuses = ['queued', 'running']) {
    const rows = await MongoDbCrudOpration(DB, {
        type: SCHEMA_TYPE.AI_INBOX,
        data: [{
            companyId: String(companyId),
            actionKey: 'develop_task',
            status: { $in: statuses },
            deletedStatusKey: { $in: [0, null] },
        }, null, { sort: { createdAt: 1 } }],
    }, 'find').catch(() => []);
    return rows || [];
}

// Fetch a task's spec (company db) so the runner gets the title + description.
async function getTaskSpec(companyId, taskId) {
    if (!mongoose.Types.ObjectId.isValid(String(taskId))) return null;
    return MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ _id: oid(taskId) }, { TaskName: 1, TaskKey: 1, description: 1, rawDescription: 1 }],
    }, 'findOne').catch(() => null);
}

module.exports = {
    getSettingsDoc, upsertSettings, setProjectRepo,
    writeAudit, listAudit, countExecutedToday,
    createInboxItem, listInbox, findInboxItem, updateInboxItem, pendingInboxKeys, handledActionKeys,
    listDevJobs, getTaskSpec,
};

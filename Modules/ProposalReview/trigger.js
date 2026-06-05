/**
 * Event-driven trigger: when a task moves INTO "In Review - TL" on a project
 * that has the `proposalReview` app enabled, run the Managed Agent and apply
 * its verdict (move to Approved or Backlog).
 *
 * Wired via the existing socketEventEmitter — no polling, no cron. The handler
 * is fire-and-forget so the originating status-update call returns immediately;
 * the agent's ~30s of work happens in the background.
 *
 * Safety:
 *   - Skips when `proposalReview` is NOT in `project.apps`
 *   - Skips when the NEW status name (resolved dynamically from
 *     `project.taskStatusData` by key) is not "In Review - TL"
 *   - Skips when the task somehow has no projectId / no taskId
 *   - applyVerdict re-reads the task before mutating and bails if a human
 *     moved it out of "In Review - TL" while the agent was thinking
 *
 * No status keys are hardcoded — keys are looked up by NAME on each project.
 */
'use strict';

const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../event/socketEventEmitter');
const { evaluateOne } = require('./evaluator');
const { applyVerdict, SOURCE_STATUS_NAME } = require('./applyVerdict');
const { isConfigured: agentConfigured } = require('./managedAgentClient');
const pg = require('./pgClient');

const APP_KEY = 'proposalReview';

// In multi-tenant AlianHub each company has its OWN MongoDB database, and
// the database NAME equals the companyId. A Mongoose document returned by
// `findOneAndUpdate` (the `data` field in the socket emit payload) carries
// its connection reference, so `doc.db.name` resolves to the companyId
// without us having to touch the emit site itself.
//
// Falls back to an explicit `payload.companyId` when present (used by the
// smoke test, which emits synthetic events on plain objects).
function extractCompanyId(payload) {
    if (payload && typeof payload.companyId === 'string' && payload.companyId) {
        return payload.companyId;
    }
    const doc = payload && payload.data;
    if (doc && doc.db && typeof doc.db.name === 'string' && doc.db.name) {
        return doc.db.name;
    }
    return null;
}

// Bulk task updates (Modules/Tasks/helpers/taskMongo/bulk.js) convert the
// task via `toObject()` before emitting, which strips Mongoose's connection
// reference — so `data.db.name` is undefined and `extractCompanyId` returns
// null. This fallback scans every open per-tenant Mongoose connection and
// finds the one whose `tasks` collection contains the given _id. The result
// is cached so subsequent events for the same task (the typical pattern when
// the bulk path emits N events in a row) are O(1).
const companyIdCacheByTaskId = new Map();
const COMPANY_ID_CACHE_MAX = 2000;

async function findCompanyIdFromTaskId(taskId) {
    if (!taskId) return null;
    if (companyIdCacheByTaskId.has(taskId)) return companyIdCacheByTaskId.get(taskId);
    let oid;
    try { oid = new mongoose.Types.ObjectId(String(taskId)); } catch (_e) { return null; }
    for (const conn of mongoose.connections) {
        const name = conn && conn.name;
        if (!name || name === 'global' || conn.readyState !== 1) continue;
        try {
            const found = await conn.collection('tasks').findOne({ _id: oid }, { projection: { _id: 1 } });
            if (found) {
                if (companyIdCacheByTaskId.size >= COMPANY_ID_CACHE_MAX) {
                    // Cheap FIFO eviction — keeps memory bounded.
                    const firstKey = companyIdCacheByTaskId.keys().next().value;
                    companyIdCacheByTaskId.delete(firstKey);
                }
                companyIdCacheByTaskId.set(String(taskId), name);
                return name;
            }
        } catch (_e) { /* ignore: connection may be closing or DB missing */ }
    }
    return null;
}

function hasProposalReviewApp(project) {
    const apps = Array.isArray(project && project.apps) ? project.apps : [];
    return apps.some((a) => {
        if (typeof a === 'string') return a === APP_KEY;
        return a && typeof a === 'object' && a.key === APP_KEY;
    });
}

function resolveStatusName(project, statusKey) {
    const arr = Array.isArray(project && project.taskStatusData) ? project.taskStatusData : [];
    const found = arr.find((s) => s && s.key === statusKey);
    return found ? found.name : null;
}

/**
 * Emit a synthetic task:update event that flips a transient
 * `proposalReviewProcessing` flag on the task. Carried by the existing
 * task-event pipeline (taskSocket → frontend Vuex), so the frontend sees the
 * change reactively and can render a spinner. NOT persisted to Mongo — the
 * flag lives only in the in-memory frontend store and is wiped on refresh.
 *
 * Our own listener (`handleTaskUpdate`) ignores these because they have no
 * `updatedFields.statusKey` — so there's no recursion.
 */
function emitSpinnerEvent(taskDataForSpinner, processing) {
    if (!taskDataForSpinner || !taskDataForSpinner._id) return;
    try {
        // Send MINIMAL payload: only the routing fields taskSocket reads
        // (ProjectID, sprintId, ParentTaskId, AssigneeUserId, _id) plus the
        // flag. Sending the whole task here would let Vuex's merge re-write
        // dozens of fields that didn't actually change, blowing up Task.vue's
        // JSON.stringify watcher and causing a full row re-render (visible as
        // a "blink"). With a minimal payload the merge only flips this one
        // field, so reactivity stays narrow and the row doesn't blink.
        const minimal = {
            _id: taskDataForSpinner._id,
            ProjectID: taskDataForSpinner.ProjectID,
            sprintId: taskDataForSpinner.sprintId,
            ParentTaskId: taskDataForSpinner.ParentTaskId || null,
            AssigneeUserId: Array.isArray(taskDataForSpinner.AssigneeUserId)
                ? taskDataForSpinner.AssigneeUserId : [],
            proposalReviewProcessing: processing,
        };
        socketEmitter.emit('update', {
            type: 'update',
            data: minimal,
            updatedFields: { proposalReviewProcessing: processing },
            module: 'task',
        });
        logger.info(`[ProposalReview] spinner emit task=${minimal._id} processing=${processing} ts=${Date.now()}`);
    } catch (e) {
        logger.error(`[ProposalReview] emitSpinnerEvent error: ${e && e.message ? e.message : e}`);
    }
}

/**
 * Run the full review pipeline for one task. Fire-and-forget.
 * @param {string} companyId
 * @param {string} taskId
 * @param {object} [taskDataForSpinner]  Optional task doc used purely to emit
 *   the transient spinner flag to the frontend. When provided, a `processing
 *   = true` event fires before the agent call and a matching `false` event
 *   fires in `finally` (covers success AND error).
 */
async function runProposalReview(companyId, taskId, taskDataForSpinner) {
    const startedAt = Date.now();
    emitSpinnerEvent(taskDataForSpinner, true);
    try {
        const evaluation = await evaluateOne(companyId, taskId);
        const v = evaluation.verdict;
        logger.info(
            `[ProposalReview] task=${taskId} company=${companyId} `
            + `verdict=${v ? v.verdict || (v.found === false ? 'NO_PROPOSAL' : 'INVALID') : 'NONE'} `
            + `skip=${evaluation.skipReason || 'none'} eval_ms=${Date.now() - startedAt}`,
        );
        const applyRes = await applyVerdict({ companyId, evaluation, dryRun: false });
        logger.info(
            `[ProposalReview] task=${taskId} applied=${applyRes.applied} `
            + `action=${applyRes.plan && applyRes.plan.action} error=${applyRes.error || 'none'} `
            + `total_ms=${Date.now() - startedAt}`,
        );
    } catch (e) {
        logger.error(`[ProposalReview] task=${taskId} pipeline error: ${e && e.message ? e.message : e}`);
    } finally {
        emitSpinnerEvent(taskDataForSpinner, false);
    }
}

/**
 * Listener for the namespaced `task:update` event. Filters quickly and
 * dispatches matching events to `runProposalReview` without awaiting.
 */
async function handleTaskUpdate(payload) {
    try {
        const newKey = payload && payload.updatedFields && payload.updatedFields.statusKey;
        if (newKey === undefined || newKey === null) return; // not a status change

        const data = payload.data;
        if (!data || !data._id || !data.ProjectID) return;

        let companyId = extractCompanyId(payload);
        if (!companyId) {
            // Bulk path (toObject'd payload) — scan open connections for the task.
            companyId = await findCompanyIdFromTaskId(String(data._id));
        }
        if (!companyId) {
            logger.warn(`[ProposalReview] task=${data._id} status changed but companyId could not be resolved; skipping`);
            return;
        }

        const project = await MongoDbCrudOpration(companyId, {
            type: dbCollections.PROJECTS,
            data: [
                { _id: new mongoose.Types.ObjectId(String(data.ProjectID)) },
                { taskStatusData: 1, apps: 1, ProjectName: 1 },
            ],
        }, 'findOne').catch(() => null);
        if (!project) return;

        if (!hasProposalReviewApp(project)) return;

        const newName = resolveStatusName(project, newKey);
        if (!newName || String(newName).toLowerCase() !== SOURCE_STATUS_NAME.toLowerCase()) return;

        // Fire-and-forget so the originating updateStatus call returns fast.
        // Pass the task doc so the spinner event can fan out to the right rooms
        // (taskSocket routes by ProjectID + sprintId on the payload's `data`).
        runProposalReview(companyId, String(data._id), data)
            .catch((e) => logger.error(`[ProposalReview] background pipeline rejected: ${e && e.message ? e.message : e}`));
    } catch (e) {
        logger.error(`[ProposalReview] trigger handler error: ${e && e.message ? e.message : e}`);
    }
}

let registered = false;
function register() {
    if (registered) return false;
    socketEmitter.on('task:update', handleTaskUpdate);
    registered = true;
    return true;
}

function isConfigured() {
    // The actor user is now a static in-code constant
    // (utils/commonFunctions.js → ALIANHUB_BOT_USER), so no env var check
    // is needed for attribution anymore. Only the agent + PG need to be set.
    return Boolean(agentConfigured() && pg.isConfigured());
}

module.exports = {
    register,
    isConfigured,
    runProposalReview,           // exported for smoke tests
    handleTaskUpdate,            // exported for smoke tests
};

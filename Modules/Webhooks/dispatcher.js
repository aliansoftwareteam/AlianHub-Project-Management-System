const axios = require('axios');
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const socketEmitter = require('../../event/socketEventEmitter');
const { createSnapshotStore } = require('../../utils/entityEvents');
const { subscribesTo, classifyTaskEvent, shouldDeliverTask, normalizeChangedFields, trimTaskForDelivery, signPayload, formatForTarget } = require('./helpers/webhookRules');

// Webhook dispatcher. Piggybacks on the namespaced socketEmitter events that
// every task mutation already fires, so no write path needed changes:
//   task:update / task:insert  →  classify → debounce → deliver → log
//
// - Tenant resolution: task documents carry CompanyId (required on the
//   schema), which is also the per-company database name.
// - Debounce: one mutation often fires several emits (counters, indexes…).
//   Events for the same company+task+event collapse within a short window
//   and deliver once with the latest document.
// - Delivery: POST with an HMAC-SHA256 signature header; one retry after
//   30s on network errors / 5xx. Every attempt is logged to webhookLogs.

const LOG_PREFIX = '[webhooks]';
const DEBOUNCE_MS = 2000;
const RETRY_DELAY_MS = 30000;
const DELIVERY_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60000;

// companyId -> { at, hooks } — tiny cache so a burst of task updates doesn't
// query the webhooks collection per event.
const hookCache = new Map();
// `${companyId}:${taskId}:${event}` -> { timer, payload }
const pending = new Map();

// taskId -> the last delivered snapshot (trimmed + name-enriched `data`). Lets a
// delivery diff against the prior state to render "from → to".
const taskSnapshots = createSnapshotStore({ max: 5000 });

let started = false;

async function getCompanyWebhooks(companyId) {
    const cached = hookCache.get(companyId);
    if (cached && (Date.now() - cached.at) < CACHE_TTL_MS) {
        return cached.hooks;
    }
    try {
        const hooks = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.WEBHOOKS,
            data: [{ active: true }],
        }, 'find');
        hookCache.set(companyId, { at: Date.now(), hooks: hooks || [] });
        return hooks || [];
    } catch (error) {
        logger.error(`${LOG_PREFIX} could not load webhooks for ${companyId}: ${error.message}`);
        return [];
    }
}

/* The controller calls this after CRUD so changes apply immediately. */
function invalidateCompanyCache(companyId) {
    hookCache.delete(String(companyId));
}

async function logDelivery(companyId, webhookId, entry) {
    try {
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.WEBHOOK_LOGS,
            data: { webhookId, ...entry },
        }, 'save');
    } catch (error) {
        logger.error(`${LOG_PREFIX} log write failed: ${error.message}`);
    }
}

async function deliverToHook(companyId, hook, body, attempt) {
    // Shape the payload for the hook's target (raw json / Slack / Discord).
    // The signature covers exactly what we send; body.event is kept for logging.
    const bodyString = JSON.stringify(formatForTarget(hook.format, body));
    const startedAt = Date.now();
    try {
        const response = await axios.post(hook.url, bodyString, {
            timeout: DELIVERY_TIMEOUT_MS,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'AlianHub-Webhooks/1.0',
                'X-AlianHub-Event': body.event,
                'X-AlianHub-Delivery-Attempt': String(attempt),
                'X-AlianHub-Signature': signPayload(hook.secret, bodyString),
            },
            // Treat any HTTP response as a response — classify below.
            validateStatus: () => true,
        });
        const success = response.status >= 200 && response.status < 300;
        await logDelivery(companyId, hook._id, {
            event: body.event,
            statusCode: response.status,
            success,
            durationMs: Date.now() - startedAt,
            attempt,
        });
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.WEBHOOKS,
            data: [{ _id: hook._id }, { $set: { lastStatus: response.status, lastDeliveredAt: new Date() } }],
        }, 'updateOne').catch(() => {});

        if (!success && response.status >= 500 && attempt === 1) {
            setTimeout(() => { deliverToHook(companyId, hook, body, 2); }, RETRY_DELAY_MS);
        }
    } catch (error) {
        await logDelivery(companyId, hook._id, {
            event: body.event,
            success: false,
            durationMs: Date.now() - startedAt,
            attempt,
            error: String(error?.message || error).slice(0, 300),
        });
        if (attempt === 1) {
            setTimeout(() => { deliverToHook(companyId, hook, body, 2); }, RETRY_DELAY_MS);
        }
    }
}

// Resolve user ids → display names. Users live in the 'global' DB. Best-effort:
// any miss or error just yields an empty map (caller falls back to a count).
async function resolveUserNames(ids) {
    const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    if (!list.length) return {};
    const objectIds = [];
    list.forEach((id) => {
        try { objectIds.push(new mongoose.Types.ObjectId(String(id))); } catch (e) { /* skip non-ObjectId ids */ }
    });
    if (!objectIds.length) return {};
    try {
        const users = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
            type: SCHEMA_TYPE.USERS,
            data: [{ _id: { $in: objectIds } }, { Employee_Name: 1 }],
        }, 'find');
        const map = {};
        (users || []).forEach((u) => { if (u && u._id) map[String(u._id)] = u.Employee_Name; });
        return map;
    } catch (error) {
        logger.error(`${LOG_PREFIX} could not resolve user names: ${error.message}`);
        return {};
    }
}

async function flush(companyId, event, doc, changedKeys) {
    const hooks = await getCompanyWebhooks(companyId);
    const targets = hooks.filter((hook) => subscribesTo(hook, event));
    if (!targets.length) return;

    // Task socket payloads can be partial (only the changed fields), which would
    // deliver a payload missing the key/name/priority and a status with no
    // friendly name (it falls back to the raw statusType). Re-read the full task
    // so every delivery is complete. Only runs when a webhook actually subscribes.
    //
    // The re-read is also a correctness gate: some create-flow emits carry a
    // NON-task document under module:'task' (the project counter bump fires
    // { data: <project>, updatedFields: {} }). Its _id is a project id, so the
    // task lookup finds nothing — and we must not deliver a project as a phantom
    // task.updated. shouldDeliverTask drops that case; a transient read error
    // still falls back to best-effort delivery with the socket doc.
    let fullDoc = null;
    let readErrored = false;
    try {
        const fresh = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ _id: doc._id }],
        }, 'findOne');
        if (fresh && fresh._id) fullDoc = fresh;
    } catch (error) {
        readErrored = true;
        logger.error(`${LOG_PREFIX} could not re-read task ${doc._id}: ${error.message}`);
    }

    if (!shouldDeliverTask(fullDoc, readErrored)) return;
    if (!fullDoc) fullDoc = doc; // transient read error → best-effort with the socket payload

    const data = trimTaskForDelivery(fullDoc);

    // Always resolve assignee + lead ids → names (one batched lookup) so the
    // snapshot we cache is complete — that's what lets the NEXT change render a
    // clean assignee/lead from→to. A lookup miss just falls back to a count.
    const userIds = [];
    if (Array.isArray(fullDoc.AssigneeUserId)) userIds.push(...fullDoc.AssigneeUserId);
    if (fullDoc.Task_Leader) userIds.push(fullDoc.Task_Leader);
    const nameMap = userIds.length ? await resolveUserNames(userIds) : {};
    data.assigneeNames = (Array.isArray(fullDoc.AssigneeUserId) ? fullDoc.AssigneeUserId : [])
        .map((id) => nameMap[String(id)]).filter(Boolean);
    if (fullDoc.Task_Leader) data.leadName = nameMap[String(fullDoc.Task_Leader)] || null;

    // before→after: diff against the last state we delivered for this task.
    const taskId = String(fullDoc._id);
    const previous = taskSnapshots.get(taskId);

    const body = {
        event,
        companyId,
        deliveredAt: new Date().toISOString(),
        changedFields: Array.from(new Set(changedKeys || [])),
        data,
    };
    if (previous) body.previous = previous;

    taskSnapshots.remember(taskId, data);
    targets.forEach((hook) => { deliverToHook(companyId, hook, body, 1); });
}

function onTaskEvent(type) {
    return (payload) => {
        try {
            const doc = payload?.data;
            if (!doc || !doc.CompanyId || !doc._id) return;
            const companyId = String(doc.CompanyId);
            const event = classifyTaskEvent({ type, doc, updatedFields: payload?.updatedFields });
            if (!event) return;

            const key = `${companyId}:${String(doc._id)}:${event}`;
            const existing = pending.get(key);
            if (existing) clearTimeout(existing.timer);
            // Accumulate the changed field names across every emit collapsed into
            // this debounce window, so the delivered notification reflects the
            // whole burst (e.g. status then priority changed back to back).
            const changed = new Set(existing ? existing.changed : []);
            normalizeChangedFields(payload?.updatedFields).forEach((field) => changed.add(field));
            pending.set(key, {
                doc,
                changed,
                timer: setTimeout(() => {
                    const entry = pending.get(key);
                    pending.delete(key);
                    if (!entry) return; // key already replaced/cleaned up — nothing to flush
                    flush(companyId, event, entry.doc, entry.changed).catch((error) => {
                        logger.error(`${LOG_PREFIX} flush failed: ${error.message}`);
                    });
                }, DEBOUNCE_MS),
            });
        } catch (error) {
            logger.error(`${LOG_PREFIX} event handling failed: ${error.message}`);
        }
    };
}

function start() {
    if (started) return;
    started = true;
    socketEmitter.on('task:update', onTaskEvent('update'));
    socketEmitter.on('task:insert', onTaskEvent('insert'));
    logger.info(`${LOG_PREFIX} dispatcher listening for task events`);
}

module.exports = {
    start,
    invalidateCompanyCache,
};

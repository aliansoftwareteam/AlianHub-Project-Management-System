const axios = require('axios');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const socketEmitter = require('../../event/socketEventEmitter');
const { subscribesTo, classifyTaskEvent, trimTaskForDelivery, signPayload, formatForTarget } = require('./helpers/webhookRules');

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

async function flush(companyId, event, doc) {
    const hooks = await getCompanyWebhooks(companyId);
    const targets = hooks.filter((hook) => subscribesTo(hook, event));
    if (!targets.length) return;

    const body = {
        event,
        companyId,
        deliveredAt: new Date().toISOString(),
        data: trimTaskForDelivery(doc),
    };
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
            pending.set(key, {
                doc,
                timer: setTimeout(() => {
                    const entry = pending.get(key);
                    pending.delete(key);
                    flush(companyId, event, entry.doc).catch((error) => {
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

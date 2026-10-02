const { AsyncResource } = require('async_hooks');
const socketEmitter = require('../../../event/socketEventEmitter');
const { originOf } = require('../../../event/domainEventBus');
const logger = require('../../../Config/loggerConfig');
const { myCache } = require('../../../Config/config');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { loadTask } = require('./source');
const fill = require('./fill');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const DEFAULT_DEBOUNCE_MS = 60 * 1000;

const PART_OF_FIELD = Object.freeze({
    TaskName: 'title',
    description: 'description',
    rawDescription: 'description',
    descriptionBlock: 'description',
});
const SUBTASK_FIELDS = Object.freeze(['TaskName', 'status', 'statusKey', 'deletedStatusKey']);

const pending = new Map();
const running = new Set();
let listeners = null;
let debounceMs = DEFAULT_DEBOUNCE_MS;

const configuredDebounce = () => {
    const n = Number(process.env.AI_FIELD_REFILL_DEBOUNCE_MS);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DEBOUNCE_MS;
};

const USES_CACHE_SECONDS = 60;

/* Most workspaces have no auto-refilled field; one cached read spares them a task read per edit. */
async function usesAutoRefill(companyId) {
    const key = `aiFieldAutoRefill:${companyId}`;
    const hit = myCache.get(key);
    if (hit !== undefined) return hit;
    const count = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.CUSTOM_FIELDS,
        data: [{ 'fieldAi.enabled': true, 'fieldAi.autoRefill': true }],
    }, 'countDocuments').catch(() => 1);
    const uses = Number(count) > 0;
    myCache.set(key, uses, USES_CACHE_SECONDS);
    return uses;
}

async function refillTask({ companyId, taskId, changed, origin = null }) {
    if (!(await usesAutoRefill(companyId))) return;
    const task = await loadTask(companyId, taskId).catch(() => null);
    const fills = (task && task.aiFieldFills) || {};
    for (const [fieldId, last] of Object.entries(fills)) {
        if (!last || !OBJECT_ID.test(String(last.by || ''))) continue;
        let loaded;
        try {
            loaded = await fill.loadDefinition(companyId, fieldId);
        } catch (_error) {
            continue;
        }
        const { definition, config } = loaded;
        if (!config.autoRefill || !config.reads.some((part) => changed.has(part))) continue;
        try {
            await fill.fillTask({ companyId, uid: last.by, definition, config, taskId, trigger: fill.TRIGGER.AUTO, unlessHash: last.hash || null, origin });
        } catch (error) {
            logger.warn(`[ai-fields] auto-refill of ${fieldId} on task ${taskId} skipped: ${error.message}`);
        }
    }
}

function run(key) {
    const entry = pending.get(key);
    if (!entry) return;
    pending.delete(key);
    clearTimeout(entry.timer);
    const work = refillTask(entry)
        .catch(fill.logFailure(`auto-refill ${key}`))
        .finally(() => running.delete(work));
    running.add(work);
}

/* A refill is made for the person recorded on the field's last fill, not for whoever edited the task: bound here,
 * where no request is running, it runs under no token's project list, no agent's mark and no request. */
const runOutsideAnyRequest = AsyncResource.bind(run);

/* The refill runs outside the request, so whose edit it follows is read here, as the edit is made, and kept with the
 * wait: an agent's edit and its depth in a chain, which the refill's own event then states, so a rule that did not ask
 * for automated changes is not woken by it. A person's edit names nobody, and the refill's event names nobody. */
const agentOrigin = (payload) => {
    const { actor, depth } = originOf(payload);
    return actor.kind === 'agent' ? { actor, depth } : null;
};

const deeper = (kept, origin) => (origin && (!kept || origin.depth >= kept.depth) ? origin : kept || null);

/* Edits come in bursts (typing in the description saves many times), so one refill runs after the last. */
function schedule(companyId, taskId, parts, origin) {
    if (!OBJECT_ID.test(String(companyId || '')) || !OBJECT_ID.test(String(taskId || '')) || !parts.length) return;
    const key = `${companyId}:${taskId}`;
    const entry = pending.get(key) || { companyId: String(companyId), taskId: String(taskId), changed: new Set() };
    parts.forEach((part) => entry.changed.add(part));
    entry.origin = deeper(entry.origin, origin);
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => runOutsideAnyRequest(key), debounceMs);
    if (entry.timer && typeof entry.timer.unref === 'function') entry.timer.unref();
    pending.set(key, entry);
}

const changedParts = (updatedFields) => [...new Set(Object.keys(updatedFields || {}).map((name) => PART_OF_FIELD[name]).filter(Boolean))];

function onTaskUpdate(payload) {
    const doc = payload && payload.data;
    if (!doc || !doc._id) return;
    const companyId = doc.CompanyId;
    const updated = Object.keys((payload && payload.updatedFields) || {});
    const origin = agentOrigin(payload);
    schedule(companyId, doc._id, changedParts(payload.updatedFields), origin);
    if (doc.ParentTaskId && updated.some((name) => SUBTASK_FIELDS.includes(name))) schedule(companyId, doc.ParentTaskId, ['subtasks'], origin);
}

function onTaskInsert(payload) {
    const doc = payload && payload.data;
    if (doc && doc.ParentTaskId) schedule(doc.CompanyId, doc.ParentTaskId, ['subtasks'], agentOrigin(payload));
}

function onCommentInsert(payload) {
    const doc = payload && payload.data;
    if (doc && payload.companyId) schedule(payload.companyId, doc.taskId, ['comments'], agentOrigin(payload));
}

function start({ debounceMs: given } = {}) {
    if (listeners) return;
    debounceMs = given === undefined ? configuredDebounce() : given;
    listeners = { 'task:update': onTaskUpdate, 'task:insert': onTaskInsert, 'comments:insert': onCommentInsert };
    Object.entries(listeners).forEach(([event, handler]) => socketEmitter.on(event, handler));
}

function stop() {
    if (listeners) Object.entries(listeners).forEach(([event, handler]) => socketEmitter.off(event, handler));
    listeners = null;
    pending.forEach((entry) => clearTimeout(entry.timer));
    pending.clear();
}

/* Runs every pending refill now and waits for all of them. */
async function flush() {
    [...pending.keys()].forEach((key) => runOutsideAnyRequest(key));
    await Promise.all([...running]);
}

module.exports = { start, stop, flush, refillTask, changedParts };

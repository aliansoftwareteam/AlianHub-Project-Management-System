const socketEmitter = require('../../event/socketEventEmitter');
const logger = require('../../Config/loggerConfig');
const { myCache } = require('../../Config/config');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { COMPUTED_TYPES } = require('./helpers/computeFields');

/* A formula or a rollup is stored on the task, so every reader shows one number. This keeps that number true: each
 * task write that changes something a formula or a rollup can read has the task, and the tasks above it, worked out
 * again. The writes are heard on the event every task write already sends. */

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const DEFAULT_DEBOUNCE_MS = 150;
const BATCH = 200;
const USES_CACHE_SECONDS = 60;
const USES_KEY = (companyId) => `computedFields:${companyId}`;

/* What computeFields.js reads from a task: the subtasks under it, its own numbers, and which fields it holds. */
const INPUTS = Object.freeze(['subTasks', 'deletedStatusKey', 'ParentTaskId', 'isParentTask', 'ProjectID', 'TaskTypeKey', 'totalEstimatedTime', 'remainingHours', 'Task_Priority', 'customField']);
const FIELD_VALUE = 'customField.';

const pending = new Map();
const running = new Set();
let listeners = null;
let debounceMs = DEFAULT_DEBOUNCE_MS;

const isComputedEntry = (value) => Boolean(value) && typeof value === 'object' && COMPUTED_TYPES.includes(value.fieldType) && 'computedAt' in value;

const readsInput = (updatedFields) => Object.entries(updatedFields || {})
    .some(([name, value]) => INPUTS.includes(name) || (name.startsWith(FIELD_VALUE) && !isComputedEntry(value)));

async function usesComputed(companyId) {
    const hit = myCache.get(USES_KEY(companyId));
    if (hit !== undefined) return hit;
    const found = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.CUSTOM_FIELDS,
        data: [{ fieldType: { $in: [...COMPUTED_TYPES] } }, { _id: 1 }],
    }, 'findOne').catch(() => true);
    const uses = Boolean(found);
    myCache.set(USES_KEY(companyId), uses, USES_CACHE_SECONDS);
    return uses;
}

async function refresh(companyId, taskIds) {
    if (!(await usesComputed(companyId))) return;
    const { refreshComputed } = require('./controller');
    for (let at = 0; at < taskIds.length; at += BATCH) {
        // eslint-disable-next-line no-await-in-loop
        await refreshComputed(companyId, taskIds.slice(at, at + BATCH));
    }
}

function run(companyId) {
    const entry = pending.get(companyId);
    if (!entry) return;
    pending.delete(companyId);
    clearTimeout(entry.timer);
    const work = refresh(companyId, [...entry.taskIds])
        .catch((error) => logger.error(`computed fields not worked out again: ${(error && error.message) || error}`))
        .finally(() => running.delete(work));
    running.add(work);
}

/* One task write sends several events (the new subtask, its parent's count), and an import sends hundreds. */
function schedule(companyId, taskIds) {
    const ids = taskIds.map((id) => String(id || '')).filter((id) => OBJECT_ID.test(id));
    if (!OBJECT_ID.test(String(companyId || '')) || !ids.length) return;
    const key = String(companyId);
    const entry = pending.get(key) || { taskIds: new Set() };
    ids.forEach((id) => entry.taskIds.add(id));
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => run(key), debounceMs);
    if (entry.timer && typeof entry.timer.unref === 'function') entry.timer.unref();
    pending.set(key, entry);
}

const companyOf = (payload) => payload.companyId || (payload.data && payload.data.CompanyId);

function onTaskUpdate(payload) {
    const doc = payload && payload.data;
    if (!doc || !doc._id || !readsInput(payload.updatedFields)) return;
    schedule(companyOf(payload), [doc._id, doc.ParentTaskId]);
}

function onTaskInsert(payload) {
    const doc = payload && payload.data;
    if (doc && doc._id) schedule(companyOf(payload), [doc._id, doc.ParentTaskId]);
}

function start({ debounceMs: given } = {}) {
    if (listeners) return;
    debounceMs = given === undefined ? DEFAULT_DEBOUNCE_MS : given;
    listeners = { 'task:update': onTaskUpdate, 'task:insert': onTaskInsert };
    Object.entries(listeners).forEach(([event, handler]) => socketEmitter.on(event, handler));
}

function stop() {
    if (listeners) Object.entries(listeners).forEach(([event, handler]) => socketEmitter.off(event, handler));
    listeners = null;
    pending.forEach((entry) => clearTimeout(entry.timer));
    pending.clear();
}

/* Runs every pending refresh now and waits for all of them. */
async function flush() {
    [...pending.keys()].forEach(run);
    await Promise.all([...running]);
}

module.exports = { start, stop, flush, readsInput, USES_KEY };

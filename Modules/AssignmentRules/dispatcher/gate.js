const crypto = require('crypto');
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');
const socketEmitter = require('../../../event/socketEventEmitter');
const domainEventBus = require('../../../event/domainEventBus');
const flag = require('./flag');
const rulesOf = require('./settings');
const guess = require('./guess');
const queue = require('./queue');
const audit = require('./audit');
const { tagNames } = require('../engine');

const LOG_PREFIX = '[dispatcher]';
const DUPLICATE_KEY = 11000;
const WATCHED_FIELDS = Object.freeze(['TaskName', 'rawDescription', 'TaskType', 'TaskTypeKey', 'tagsArray', 'Task_Priority', 'statusKey', 'status', 'sprintId', 'customField']);
const TASK_FIELDS = {
    TaskName: 1, TaskKey: 1, rawDescription: 1, TaskType: 1, TaskTypeKey: 1, tagsArray: 1, Task_Priority: 1, statusKey: 1,
    sprintId: 1, customField: 1, ProjectID: 1, deletedStatusKey: 1, mainChat: 1,
};
/* Decisions a lead has not acted on yet; a newer decision for the same task replaces them. */
const WAITING = Object.freeze(['suggested', 'needs_routing']);

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const plain = (row) => (row && typeof row.toObject === 'function' ? row.toObject() : row);
const failureText = (error) => (error && error.message) || String(error);
const skip = (reason) => ({ skipped: reason });

const readTask = async (companyId, taskId) => {
    if (!mongoose.Types.ObjectId.isValid(String(taskId || ''))) return null;
    return plain(await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS, data: [{ _id: oid(taskId), deletedStatusKey: { $ne: 1 } }, TASK_FIELDS],
    }, 'findOne'));
};

const fieldValues = (task) => Object.entries(task.customField || {}).map(([id, entry]) => [id, entry && typeof entry === 'object' ? entry.fieldValue : entry])
    .sort(([a], [b]) => a.localeCompare(b));

const hashOf = (task, revision) => crypto.createHash('sha256').update(JSON.stringify([
    String(task._id), task.TaskName || '', task.rawDescription || '', task.TaskTypeKey, [...(task.tagsArray || [])].map(String).sort(),
    task.Task_Priority || '', task.statusKey, String(task.sprintId || ''), fieldValues(task), revision,
])).digest('hex');

/* Why a role cannot take work in this project, or '' when it can. */
const roleProblem = (settings, key) => {
    if (!rulesOf.roleOf(key)) return 'unknown_role';
    if (!settings.roles.includes(key)) return 'role_off';
    return '';
};

const announce = (companyId, decision) => socketEmitter.emit('update', {
    type: 'update',
    module: 'dispatchDecisions',
    companyId: String(companyId),
    data: { _id: String(decision._id), taskId: decision.taskId, projectId: decision.projectId, state: decision.state },
});

/* A second node routing the same input loses on the unique index and stops. */
async function claim(companyId, fields) {
    const now = new Date();
    try {
        const saved = plain(await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DISPATCH_DECISIONS, data: { ...fields, createdAt: now, updatedAt: now },
        }, 'save'));
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DISPATCH_DECISIONS,
            data: [{ taskId: fields.taskId, state: { $in: WAITING }, _id: { $ne: saved._id } }, { $set: { state: 'superseded', updatedAt: now } }],
        }, 'updateMany');
        return saved;
    } catch (error) {
        if (error && error.code === DUPLICATE_KEY) return null;
        throw error;
    }
}

async function findRole(companyId, task, settings) {
    const skipped = [];
    for (const [ruleIndex, rule] of settings.rules.entries()) {
        if (rulesOf.matches(rule.when, task)) {
            const why = roleProblem(settings, rule.role);
            if (!why) return { pick: { role: rule.role, source: 'rule', ruleIndex }, skipped };
            skipped.push({ ruleIndex, role: rule.role, why });
        }
    }
    if (settings.modelGuess) {
        const roles = settings.roles.filter((key) => !roleProblem(settings, key)).map((key) => ({ key, name: rulesOf.roleName(key) }));
        const project = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: oid(task.ProjectID) }, { tagsArray: 1 }] }, 'findOne');
        const input = { title: task.TaskName || '', type: task.TaskType || '', tags: tagNames(task, plain(project) || {}), description: task.rawDescription || '' };
        const guessed = await guess.guess({ companyId, task: input, roles });
        if (guessed && guessed.confidence >= settings.threshold) return { pick: { role: guessed.role, source: 'model', confidence: guessed.confidence }, skipped };
    }
    return { pick: null, skipped };
}

/*
 * One routing for one task input: the rules in order, then the model's guess when the project allows it, otherwise the
 * project's Needs routing list. Suggest mode waits for a lead; apply mode puts the task in the role's queue at once.
 */
async function route({ companyId, taskId, trigger = 'create' }) {
    if (!flag.enabled()) return skip('flag_off');
    const task = await readTask(companyId, taskId);
    if (!task || task.mainChat === true || !task.ProjectID) return skip('no_task');
    const settings = await rulesOf.load(companyId, task.ProjectID);
    if (settings.mode === 'off') return skip('off');
    if (await queue.paused(companyId, task.ProjectID)) return skip('paused');
    if (await queue.queuedRole(companyId, task)) return skip('queued');
    const inputHash = hashOf(task, settings.revision);
    const seen = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.DISPATCH_DECISIONS, data: [{ taskId: String(task._id), inputHash }, { _id: 1 }] }, 'findOne');
    if (seen) return skip('decided');

    const { pick, skipped } = await findRole(companyId, task, settings);
    const agent = pick ? await queue.leastLoaded(companyId, pick.role) : null;
    let state = 'needs_routing';
    if (pick) state = settings.mode === 'apply' ? 'applied' : 'suggested';
    const decision = await claim(companyId, {
        taskId: String(task._id), projectId: String(task.ProjectID), inputHash, trigger, state, mode: settings.mode,
        role: pick ? pick.role : null, source: pick ? pick.source : null,
        ruleIndex: pick && pick.source === 'rule' ? pick.ruleIndex : null,
        confidence: pick && pick.source === 'model' ? pick.confidence : null,
        agentId: agent ? agent.id : null, skipped,
        taskTypeKey: Number.isFinite(Number(task.TaskTypeKey)) && task.TaskTypeKey !== null ? Number(task.TaskTypeKey) : null,
    });
    if (!decision) return skip('decided');
    if (state === 'applied') await queue.put(companyId, task, { role: pick.role, agentId: decision.agentId, by: 'dispatcher' });
    audit.routed(companyId, task, {
        state, mode: settings.mode, trigger, role: decision.role, source: decision.source, ruleIndex: decision.ruleIndex, confidence: decision.confidence, agentId: decision.agentId, skipped,
    });
    announce(companyId, decision);
    return decision;
}

const triggerOf = (envelope) => {
    if (!envelope || !envelope.entity || envelope.entity.kind !== 'task' || !envelope.companyId) return null;
    if (envelope.type === 'task.created') return 'create';
    const changed = Array.isArray(envelope.changedFields) ? envelope.changedFields : [];
    return changed.some((field) => WATCHED_FIELDS.some((watched) => field === watched || String(field).startsWith(`${watched}.`))) ? 'change' : null;
};

const running = new Set();
const lanes = new Map();

/* One routing at a time per company, off the request path. */
function enqueue(companyId, taskId, trigger) {
    const previous = lanes.get(companyId) || Promise.resolve();
    const job = previous
        .then(() => route({ companyId, taskId, trigger }))
        .catch((error) => logger.error(`${LOG_PREFIX} task ${taskId} in company ${companyId}: ${failureText(error)}`))
        .finally(() => {
            running.delete(job);
            if (lanes.get(companyId) === job) lanes.delete(companyId);
        });
    running.add(job);
    lanes.set(companyId, job);
}

function onEvent(envelope) {
    try {
        if (!flag.enabled()) return;
        const trigger = triggerOf(envelope);
        if (!trigger || (Number(envelope.depth) || 0) >= domainEventBus.MAX_DEPTH) return;
        enqueue(String(envelope.companyId), String(envelope.entity.id), trigger);
    } catch (error) {
        logger.error(`${LOG_PREFIX} event handling failed: ${failureText(error)}`);
    }
}

let started = false;

function start() {
    if (started) return;
    started = true;
    domainEventBus.start();
    domainEventBus.bus.on('domain.event', onEvent);
}

async function idle() {
    while (running.size) {
        await Promise.all([...running]);
        await new Promise((resolve) => setImmediate(resolve));
    }
}

module.exports = { WAITING, WATCHED_FIELDS, route, start, idle, triggerOf, readTask, roleProblem, announce };

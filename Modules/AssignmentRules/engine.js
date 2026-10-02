const crypto = require('crypto');
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const socketEmitter = require('../../event/socketEventEmitter');
const domainEventBus = require('../../event/domainEventBus');
const { sanitizeInput } = require('../serviceFunction');
const { FEATURES } = require('../AICore/features');
const aiSwitch = require('../AICore/aiSwitch');
const { isAnyProviderConfigured } = require('../AICore/llmProvider');
const { askModel } = require('../AICore/modelCall');
const { loadRules, canTake, namesOf, plain } = require('./rules');
const prompts = require('./prompts');

const LOG_PREFIX = '[assignment-rules]';
const DAILY_DECISION_LIMIT = 500;
const PER_COMPANY = 2;
const MAX_WAITING = 200;
const ACTOR_NAME = 'Assignment rules';
/* The bus knows no kind of its own for rules; 'automation' is the one its loop guard and the automation matcher honour. */
const RULE_ACTOR = Object.freeze({ kind: 'automation', userId: null });
/* No assignee or watcher field: those are all the rules ever write, so their own writes cannot wake them again. */
const WATCHED_FIELDS = Object.freeze(['TaskName', 'rawDescription', 'descriptionBlock', 'TaskType', 'TaskTypeKey', 'tagsArray']);
const TASK_FIELDS = {
    TaskName: 1, TaskKey: 1, rawDescription: 1, TaskType: 1, TaskTypeKey: 1, tagsArray: 1, AssigneeUserId: 1,
    ProjectID: 1, sprintId: 1, folderObjId: 1, deletedStatusKey: 1, mainChat: 1, createdAt: 1,
};
const OPEN_STATES = Object.freeze(['suggested', 'applied']);

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const failureText = (error) => (error && error.message) || String(error);

const readTask = async (companyId, taskId) => {
    if (!mongoose.Types.ObjectId.isValid(String(taskId || ''))) return null;
    return plain(await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ _id: oid(taskId), deletedStatusKey: { $ne: 1 } }, TASK_FIELDS],
    }, 'findOne'));
};

const readProject = async (companyId, projectId) => plain(await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PROJECTS,
    data: [{ _id: oid(projectId) }, { ProjectName: 1, ProjectCode: 1, CompanyId: 1, lastTaskId: 1, tagsArray: 1, taskTypeCounts: 1 }],
}, 'findOne')) || {};

const hasAssignee = (task) => Array.isArray(task.AssigneeUserId) && task.AssigneeUserId.length > 0;

const tagNames = (task, project) => {
    const known = new Map((project.tagsArray || []).filter(Boolean).map((tag) => [String(tag.uid || tag.id || tag._id), tag.name || tag.tagName || '']));
    return (task.tagsArray || []).map((id) => known.get(String(id)) || '').filter(Boolean);
};

const typeName = (task, project) => {
    const counted = (project.taskTypeCounts || []).find((type) => type && Number(type.key) === Number(task.TaskTypeKey));
    return (counted && counted.name) || task.TaskType || '';
};

const taskInput = (task, project) => ({
    title: task.TaskName || '',
    type: typeName(task, project),
    tags: tagNames(task, project),
    description: task.rawDescription || '',
});

const hashOf = (taskId, input, revision) => crypto.createHash('sha256')
    .update(JSON.stringify([String(taskId), input.title, input.type, [...input.tags].sort(), input.description, revision]))
    .digest('hex');

const startOfDay = () => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

const decidedToday = (companyId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.ASSIGNMENT_DECISIONS,
    data: [{ createdAt: { $gte: startOfDay() } }],
}, 'countDocuments');

const announce = (companyId, decision) => socketEmitter.emit('update', {
    type: 'update',
    module: 'assignmentDecisions',
    companyId: String(companyId),
    data: { _id: String(decision._id), taskId: decision.taskId, projectId: decision.projectId, state: decision.state },
});

async function updateDecision(companyId, decision, set) {
    const next = { ...set, updatedAt: new Date() };
    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.ASSIGNMENT_DECISIONS,
        data: [{ _id: decision._id }, { $set: next }],
    }, 'updateOne');
    const merged = { ...decision, ...next };
    announce(companyId, merged);
    return merged;
}

/* A second node deciding the same revision loses on the unique index and stops. */
async function claim(companyId, fields) {
    const now = new Date();
    try {
        const saved = plain(await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.ASSIGNMENT_DECISIONS,
            data: { ...fields, state: 'pending', createdAt: now, updatedAt: now },
        }, 'save'));
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.ASSIGNMENT_DECISIONS,
            data: [{ taskId: fields.taskId, state: 'suggested', _id: { $ne: saved._id } }, { $set: { state: 'superseded', updatedAt: now } }],
        }, 'updateMany');
        return saved;
    } catch (error) {
        if (error && error.code === 11000) return null;
        throw error;
    }
}

const HISTORY_KEYS = Object.freeze({ suggested: 'AI_Assignment_Suggested', applied: 'AI_Assignment_Applied', no_match: 'AI_Assignment_No_Match' });

const historyMessage = ({ state, name, source, reason, model, mode }) => {
    const who = `<b>${sanitizeInput(ACTOR_NAME)}</b>`;
    const person = `<b>${sanitizeInput(name || 'Someone')}</b>`;
    const why = reason ? `: ${sanitizeInput(reason)}` : '';
    const how = ` — model ${sanitizeInput(model || 'none')}, ${sanitizeInput(mode)} mode.`;
    const asFallback = source === 'fallback' ? ' as the fallback' : '';
    if (state === 'applied') return `${who} assigned ${person}${asFallback}${why}${how}`;
    if (state === 'suggested') return `${who} suggested ${person}${asFallback}${why}${how}`;
    return `${who} matched nobody${why}${how}`;
};

const recordHistory = (companyId, task, rules, fields) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.HISTORY,
    data: {
        Type: 'task',
        Key: HISTORY_KEYS[fields.state],
        UserId: rules.updatedBy || fields.userId || 'assignment-rules',
        ProjectId: String(task.ProjectID),
        TaskId: String(task._id),
        Message: historyMessage({ ...fields, mode: rules.mode }),
    },
}, 'save').catch((error) => logger.error(`${LOG_PREFIX} history for task ${task._id}: ${failureText(error)}`));

const projectDataOf = (companyId, project, task) => ({
    _id: String(task.ProjectID),
    CompanyId: String(companyId),
    ProjectName: project.ProjectName || '',
    ProjectCode: project.ProjectCode || '',
    lastTaskId: project.lastTaskId,
});

const taskDataOf = (task) => ({
    _id: String(task._id),
    TaskName: task.TaskName || '',
    sprintId: task.sprintId ? String(task.sprintId) : '',
    folderObjId: task.folderObjId ? String(task.folderObjId) : '',
    ProjectID: String(task.ProjectID),
});

/* The normal assignee path, so history, watchers, notifications and sockets behave as for a person. */
const changeAssignee = ({ companyId, project, task, userId, name, type, userData, eventActor, eventDepth, eventNarrowing }) => require('../Tasks/helpers/task_class_Mongo').taskMongo.updateAssignee({
    firebaseObj: { AssigneeUserId: userId },
    projectData: projectDataOf(companyId, project, task),
    taskData: taskDataOf(task),
    employeeName: name,
    type,
    userData: { companyOwnerId: '', ...userData },
    isUpdateTask: true,
    eventActor,
    eventDepth,
    eventNarrowing,
});

async function eligibleCandidates(companyId, task, entries) {
    const names = await namesOf(companyId, entries.map((entry) => entry.userId));
    const kept = [];
    for (const entry of entries) {
        if (await canTake(companyId, entry.userId, task)) kept.push({ ...entry, name: names.get(entry.userId) || '' });
    }
    return kept;
}

const skip = (reason) => ({ skipped: reason });

async function pickWithModel(companyId, input, candidates) {
    if (!candidates.length) return { userId: null, claimed: null, reason: '', model: '' };
    const answer = await askModel(prompts.DECIDE, {
        prompt: prompts.decisionPrompt(input, candidates),
        budget: {},
        spend: { feature: FEATURES.ASSIGNMENT_RULES, companyId: String(companyId) },
    });
    if (!answer.raw) return { failed: answer.degraded || 'no answer', model: answer.model || '' };
    return { ...prompts.readPick(answer.raw), model: answer.model || '' };
}

/*
 * One decision for one task revision. Nothing happens for a task that already has an assignee, a project without
 * rules, a trigger the rules switched off, or while AI is off or no model is configured — not even the fallback,
 * which answers "the model matched nobody" and is not a replacement for the model.
 */
async function decide({ companyId, taskId, trigger = 'create', depth = 0, narrowing = null }) {
    const task = await readTask(companyId, taskId);
    if (!task || task.mainChat === true || !task.ProjectID) return skip('no_task');
    if (hasAssignee(task)) return skip('assigned');
    const rules = await loadRules(companyId, task.ProjectID);
    if (!rules || (!rules.entries.length && !rules.fallbackUserId)) return skip('no_rules');
    if (trigger === 'change' ? !rules.onChange : !rules.onCreate) return skip('trigger_off');
    if (!(await aiSwitch.allowed(companyId))) return skip('ai_off');
    if (!isAnyProviderConfigured()) return skip('no_provider');

    const project = await readProject(companyId, task.ProjectID);
    const input = taskInput(task, project);
    const inputHash = hashOf(task._id, input, rules.revision);
    const seen = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.ASSIGNMENT_DECISIONS, data: [{ taskId: String(task._id), inputHash }, { _id: 1 }] }, 'findOne');
    if (seen) return skip('decided');
    if ((await decidedToday(companyId)) >= DAILY_DECISION_LIMIT) return skip('daily_limit');
    const budget = await require('../Agents/budget').check(companyId);
    if (!budget.ok) return skip('budget');

    const decision = await claim(companyId, {
        taskId: String(task._id), projectId: String(task.ProjectID), inputHash, trigger, mode: rules.mode,
        rulesRevision: rules.revision, rulesBy: rules.updatedBy,
    });
    if (!decision) return skip('decided');

    try {
        const candidates = await eligibleCandidates(companyId, task, rules.entries);
        const pick = await pickWithModel(companyId, input, candidates);
        if (pick.failed) return updateDecision(companyId, decision, { state: 'failed', reason: prompts.oneLine(pick.failed, 200), model: pick.model });

        const listed = candidates.some((candidate) => candidate.userId === pick.userId);
        const fields = {
            userId: listed ? pick.userId : null,
            source: listed ? 'model' : null,
            rejectedUserId: !listed && pick.claimed ? pick.claimed : null,
            reason: pick.reason,
            model: pick.model,
        };
        if (!fields.userId && rules.fallbackUserId && await canTake(companyId, rules.fallbackUserId, task)) {
            fields.userId = rules.fallbackUserId;
            fields.source = 'fallback';
        }
        if (!fields.userId) {
            await recordHistory(companyId, task, rules, { ...fields, state: 'no_match' });
            return updateDecision(companyId, decision, { ...fields, state: 'no_match' });
        }

        const fresh = await readTask(companyId, taskId);
        if (!fresh || hasAssignee(fresh)) return updateDecision(companyId, decision, { ...fields, state: 'stale' });

        const name = (await namesOf(companyId, [fields.userId])).get(fields.userId) || '';
        let state = 'suggested';
        if (rules.mode === 'apply') {
            await changeAssignee({
                companyId, project, task: fresh, userId: fields.userId, name, type: 'assigneeAdd',
                userData: { id: rules.updatedBy || fields.userId, Employee_Name: ACTOR_NAME },
                eventActor: RULE_ACTOR,
                eventDepth: (Number(depth) || 0) + 1,
                eventNarrowing: narrowing,
            });
            state = 'applied';
        }
        await recordHistory(companyId, fresh, rules, { ...fields, name, state });
        return updateDecision(companyId, decision, { ...fields, state });
    } catch (error) {
        logger.error(`${LOG_PREFIX} task ${taskId} in company ${companyId}: ${failureText(error)}`);
        return updateDecision(companyId, decision, { state: 'failed', reason: prompts.oneLine(failureText(error), 200) });
    }
}

const triggerOf = (envelope) => {
    if (!envelope || !envelope.entity || envelope.entity.kind !== 'task' || !envelope.companyId) return null;
    if (envelope.type === 'task.created') return 'create';
    if (envelope.actor && ['automation', 'import'].includes(envelope.actor.kind)) return null;
    const changed = Array.isArray(envelope.changedFields) ? envelope.changedFields : [];
    return changed.some((field) => WATCHED_FIELDS.includes(field)) ? 'change' : null;
};

const lanes = new Map();
const queued = new Set();
const running = new Set();

/* A few decisions per company at a time, so a bulk import cannot hold every model slot. */
function enqueue(companyId, taskId, trigger, depth, narrowing) {
    const key = `${companyId}:${taskId}`;
    if (queued.has(key)) return;
    const lane = lanes.get(companyId) || { active: 0, waiting: [] };
    if (lane.waiting.length >= MAX_WAITING) {
        logger.warn(`${LOG_PREFIX} queue full for company ${companyId}; task ${taskId} left undecided`);
        return;
    }
    lanes.set(companyId, lane);
    queued.add(key);
    const begin = () => {
        lane.active += 1;
        const job = decide({ companyId, taskId, trigger, depth, narrowing })
            .catch((error) => logger.error(`${LOG_PREFIX} task ${taskId} in company ${companyId}: ${failureText(error)}`))
            .finally(() => {
                queued.delete(key);
                running.delete(job);
                lane.active -= 1;
                const next = lane.waiting.shift();
                if (next) next();
                else if (!lane.active) lanes.delete(companyId);
            });
        running.add(job);
    };
    if (lane.active < PER_COMPANY) begin();
    else lane.waiting.push(begin);
}

function onEvent(envelope) {
    try {
        const trigger = triggerOf(envelope);
        if (!trigger) return;
        const assignees = envelope.data && Array.isArray(envelope.data.AssigneeUserId) ? envelope.data.AssigneeUserId : [];
        const depth = Number(envelope.depth) || 0;
        if (assignees.length || depth >= domainEventBus.MAX_DEPTH) return;
        enqueue(String(envelope.companyId), String(envelope.entity.id), trigger, depth, envelope.narrowing || null);
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
    while (running.size || queued.size) {
        await Promise.all([...running]);
        await new Promise((resolve) => setImmediate(resolve));
    }
}

module.exports = { DAILY_DECISION_LIMIT, WATCHED_FIELDS, OPEN_STATES, ACTOR_NAME, decide, start, idle, triggerOf, readTask, readProject, hasAssignee, tagNames, changeAssignee, updateDecision };

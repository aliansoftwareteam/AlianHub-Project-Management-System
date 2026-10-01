const crypto = require('crypto');
const mongoose = require('mongoose');
const { DateTime, IANAZone } = require('luxon');
const logger = require('../../../Config/loggerConfig');
const socketEmitter = require('../../../event/socketEventEmitter');
const { myCache } = require('../../../Config/config');
const { dbCollections } = require('../../../Config/collections');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { evaluatePermission, isWritable } = require('../../../Config/permissionGuard');
const { FEATURES } = require('../../AICore/features');
const { visibleTask } = require('../../AI/taskAccess');
const { customFieldDefinitionOf } = require('../helpers/customFieldText');
const { fieldAppliesToTask } = require('../helpers/fieldTaskTypes');
const { aiConfigOf } = require('./config');
const { readParts, hasContent, hashOf, TASK_PROJECTION } = require('./source');
const { buildRequest, parseAnswer } = require('./prompt');
const { specOf, blank } = require('./outputs');
const limits = require('./limits');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const PERMISSION = 'task.task_custom_field';
const PREVIEW_MAX = 5;
const PROPOSAL_TTL_SECONDS = 30 * 60;
const REQUEST_TIMEOUT_MS = 60_000;

const TRIGGER = Object.freeze({ MANUAL: 'manual', BULK: 'bulk', AUTO: 'auto' });

const REFUSAL = Object.freeze({ NOT_FOUND: 'not_found', FORBIDDEN: 'forbidden', NOT_IN_PROJECT: 'not_in_project', NOT_FOR_TASK_TYPE: 'not_for_task_type' });

const GATE_STATUS = Object.freeze({
    [limits.STOP.AI_OFF]: 403,
    [limits.STOP.NO_PROVIDER]: 503,
    [limits.STOP.DAILY_LIMIT]: 429,
    [limits.STOP.BUDGET]: 429,
});

class AiFieldError extends Error {
    constructor(statusCode, message, code) {
        super(message);
        this.name = 'AiFieldError';
        this.statusCode = statusCode;
        if (code) this.code = code;
    }
}

const gateError = (verdict) => new AiFieldError(GATE_STATUS[verdict.code] || 403, verdict.reason, verdict.code);

async function loadDefinition(companyId, fieldId) {
    if (!OBJECT_ID.test(String(fieldId || ''))) throw new AiFieldError(404, 'AI field not found.');
    const definition = await customFieldDefinitionOf(companyId, String(fieldId));
    const config = aiConfigOf(definition);
    if (!definition || definition.isDelete === false || !config) throw new AiFieldError(404, 'AI field not found.');
    return { definition: { ...definition, _id: String(definition._id) }, config };
}

const appliesToProject = (definition, projectId) => definition.global === true
    || [].concat(definition.projectId || []).map(String).includes(String(projectId));

/* The task as `uid` may edit this field on it, or the reason they may not; checked before any read or model call. */
async function editableTask({ companyId, uid, definition, taskId }) {
    const task = OBJECT_ID.test(String(taskId || ''))
        ? await visibleTask({ companyId, uid, taskId: String(taskId), projection: TASK_PROJECTION }).catch(() => null)
        : null;
    if (!task) return { reason: REFUSAL.NOT_FOUND };
    const projectId = String(task.ProjectID);
    if (!appliesToProject(definition, projectId)) return { reason: REFUSAL.NOT_IN_PROJECT };
    if (!fieldAppliesToTask(definition, task)) return { reason: REFUSAL.NOT_FOR_TASK_TYPE };
    const permission = await evaluatePermission(companyId, String(uid), PERMISSION, { projectId }).catch(() => null);
    if (!isWritable(permission)) return { reason: REFUSAL.FORBIDDEN };
    return { task };
}

/* A date is read in the zone of the person the fill runs as; the workspace keeps no zone of its own. */
async function outputContext({ uid, config, task }) {
    if (!specOf(config.output).needsDates) return {};
    const user = OBJECT_ID.test(String(uid)) ? await MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: SCHEMA_TYPE.USERS,
        data: [{ _id: new mongoose.Types.ObjectId(String(uid)) }, { Time_Zone: 1 }],
    }, 'findOne').catch(() => null) : null;
    const zone = user && user.Time_Zone && IANAZone.isValidZone(user.Time_Zone) ? user.Time_Zone : 'UTC';
    const start = task && task.startDate ? DateTime.fromJSDate(new Date(task.startDate), { zone }) : null;
    return { zone, today: DateTime.now().setZone(zone).toISODate(), startDate: start && start.isValid ? start.toISODate() : '' };
}

async function askModel({ companyId, uid, definition, config, parts, task }) {
    const provider = require('../../AICore/llmProvider').getProvider();
    const context = await outputContext({ uid, config, task });
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('AI field request timed out')), REQUEST_TIMEOUT_MS); });
    try {
        const result = await Promise.race([
            provider.chat({ ...buildRequest(definition, config, parts, context), spend: { feature: FEATURES.AI_FIELD, companyId, userId: String(uid) } }),
            timeout,
        ]);
        return parseAnswer(definition, config, result && result.content, context);
    } finally {
        clearTimeout(timer);
    }
}

/* One model call for one task. The caps are read first, so a refused call costs nothing. */
async function propose({ companyId, uid, definition, config, task, parts: given = null }) {
    const parts = given || await readParts({ companyId, task, reads: config.reads });
    const hash = hashOf(parts);
    if (!hasContent(parts)) return { ...blank(config.output, 'no_source'), hash };
    const verdict = await limits.gate(companyId);
    if (!verdict.ok) throw gateError(verdict);
    return { ...(await askModel({ companyId, uid, definition, config, parts, task })), hash };
}

const proposalKey = (id) => `aiFieldProposal:${id}`;

const remember = (entry) => {
    const id = crypto.randomBytes(12).toString('hex');
    myCache.set(proposalKey(id), entry, PROPOSAL_TTL_SECONDS);
    return id;
};

/* A preview is only ever applied by the person it was made for, in its own company and field. */
function recall({ companyId, uid, fieldId, proposalId }) {
    if (typeof proposalId !== 'string' || !/^[a-f0-9]{24}$/.test(proposalId)) return null;
    const entry = myCache.get(proposalKey(proposalId));
    if (!entry || entry.companyId !== String(companyId) || entry.uid !== String(uid) || entry.fieldId !== String(fieldId)) return null;
    return entry;
}

const forget = (proposalId) => myCache.del(proposalKey(proposalId));

/* The task custom-field update path the web app uses: the same payload preparation, actor and stored task,
 * then the same handler, which emits the change and records the history, here marked as filled by AI. */
async function writeFill({ companyId, uid, definition, config, taskId, fieldValue, hash, trigger }) {
    const { prepareTaskRequest, TASK_ACTION_FIELDS } = require('../../Tasks/helpers/taskWriteFields');
    const { taskMongo } = require('../../Tasks/helpers/task_class_Mongo');
    const fieldId = String(definition._id);
    const request = {
        uid: String(uid),
        aud: String(companyId),
        headers: { companyid: String(companyId) },
        body: { action: 'updateTaskCustomField', companyId: String(companyId), taskId: String(taskId), customFieldId: fieldId, updateDetail: { fieldValue, _id: fieldId } },
    };
    const { payload } = await prepareTaskRequest(request, TASK_ACTION_FIELDS.updateTaskCustomField, 'updateTaskCustomField');
    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ _id: new mongoose.Types.ObjectId(String(taskId)) }, { $set: { [`aiFieldFills.${fieldId}`]: { at: new Date(), by: String(uid), template: config.template, hash, trigger } } }],
    }, 'updateOne');
    await taskMongo.updateTaskCustomField({ ...payload, filledByAi: true });
}

/* The value is left as it was; the marker lets the task say the fill did not fit until a later fill replaces it. */
async function markFailed({ companyId, definition, taskId, reason, trigger }) {
    const path = `aiFieldFills.${String(definition._id)}.failed`;
    const failed = { at: new Date(), reason, trigger };
    const task = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ _id: new mongoose.Types.ObjectId(String(taskId)) }, { $set: { [path]: failed } }, { returnDocument: 'after' }],
    }, 'findOneAndUpdate');
    if (task) socketEmitter.emit('update', { type: 'update', data: task, updatedFields: { [path]: failed }, module: 'task' });
}

const refusedProposal = (taskId, reason) => ({ taskId: String(taskId), proposalId: null, text: '', fieldValue: null, empty: true, reason });

const idList = (ids, max) => {
    if (!Array.isArray(ids) || !ids.length || ids.length > max) throw new AiFieldError(400, `Send between 1 and ${max} tasks.`);
    return [...new Set(ids.map(String))];
};

async function proposeFills({ companyId, uid, fieldId, taskIds }) {
    const ids = idList(taskIds, PREVIEW_MAX);
    const { definition, config } = await loadDefinition(companyId, fieldId);
    const proposals = [];
    for (const taskId of ids) {
        const { task, reason } = await editableTask({ companyId, uid, definition, taskId });
        if (!task) {
            proposals.push(refusedProposal(taskId, reason));
            continue;
        }
        const answer = await propose({ companyId, uid, definition, config, task });
        const proposalId = answer.empty ? null : remember({
            companyId: String(companyId), uid: String(uid), fieldId: definition._id, taskId: String(taskId), fieldValue: answer.fieldValue, hash: answer.hash,
        });
        proposals.push({
            taskId: String(taskId), taskName: String(task.TaskName || ''), proposalId, text: answer.text, fieldValue: answer.fieldValue, empty: answer.empty,
            ...(answer.reason ? { reason: answer.reason } : {}),
            ...(answer.invalid ? { invalid: true } : {}),
        });
    }
    return { proposals };
}

async function applyProposal({ companyId, uid, definition, config, entry, trigger }) {
    const { task, reason } = await editableTask({ companyId, uid, definition, taskId: entry.taskId });
    if (!task) return { reason };
    await writeFill({ companyId, uid, definition, config, taskId: entry.taskId, fieldValue: entry.fieldValue, hash: entry.hash, trigger });
    return {};
}

async function applyProposals({ companyId, uid, fieldId, proposalIds }) {
    const ids = Array.isArray(proposalIds) ? proposalIds.slice(0, PREVIEW_MAX) : [];
    const entries = ids.map((proposalId) => ({ proposalId, entry: recall({ companyId, uid, fieldId, proposalId }) }));
    const applied = [];
    const refused = entries.filter(({ entry }) => !entry).map(({ proposalId }) => ({ proposalId: String(proposalId), reason: 'expired' }));
    const usable = entries.filter(({ entry }) => entry);
    if (!usable.length) return { applied, refused };
    const { definition, config } = await loadDefinition(companyId, fieldId);
    for (const { proposalId, entry } of usable) {
        const outcome = await applyProposal({ companyId, uid, definition, config, entry, trigger: TRIGGER.MANUAL });
        forget(proposalId);
        if (outcome.reason) refused.push({ taskId: entry.taskId, reason: outcome.reason });
        else applied.push(entry.taskId);
    }
    return { applied, refused };
}

/* Propose and write in one go, for a job the person already confirmed from its preview or for an auto-refill. */
async function fillTask({ companyId, uid, definition, config, taskId, trigger, unlessHash = null }) {
    const { task, reason } = await editableTask({ companyId, uid, definition, taskId });
    if (!task) return { outcome: 'skipped', reason };
    const parts = await readParts({ companyId, task, reads: config.reads });
    if (unlessHash && hashOf(parts) === unlessHash) return { outcome: 'unchanged' };
    const answer = await propose({ companyId, uid, definition, config, task, parts });
    if (answer.invalid) {
        await markFailed({ companyId, definition, taskId, reason: answer.reason, trigger });
        return { outcome: 'failed', reason: answer.reason };
    }
    if (answer.empty) return { outcome: 'empty', reason: answer.reason };
    await writeFill({ companyId, uid, definition, config, taskId, fieldValue: answer.fieldValue, hash: answer.hash, trigger });
    return { outcome: 'filled' };
}

const logFailure = (what) => (error) => logger.error(`[ai-fields] ${what}: ${(error && error.message) || error}`);

module.exports = {
    TRIGGER,
    REFUSAL,
    PREVIEW_MAX,
    AiFieldError,
    loadDefinition,
    editableTask,
    proposeFills,
    applyProposals,
    applyProposal,
    recall,
    forget,
    fillTask,
    logFailure,
};

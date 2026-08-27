'use strict';

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { dbCollections } = require('../../../Config/collections');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { evaluatePermission } = require('../../../Config/permissionGuard');
const socketEmitter = require('../../../event/socketEventEmitter');
const logger = require('../../../Config/loggerConfig');
const {
    OBJECT_ID,
    NATIVE_ASSIGNEE_ID,
    NATIVE_DUE_ID,
    AUTOFILL_SYSTEM,
    isAiAction,
    permissionGate,
    listEmptyTargets,
    sanitizeSuggestions,
    heuristicSuggestions,
    planAutofillWrites,
    parseSuggestionsPayload,
    buildAutofillPrompt,
    previewFromParts,
    descriptionText,
    recordId,
    isDueDateEmpty,
} = require('./taskAiAutofill');

let providerFactory = null;
try {
    providerFactory = require('../../AIProjectGenerator/llmProvider');
} catch (_e) {
    providerFactory = null;
}

const REQUEST_TIMEOUT_MS = 120_000;
const AUTOFILL_MAX_TOKENS = 2048;

function isAiConfigured() {
    return Boolean(providerFactory && typeof providerFactory.isAnyProviderConfigured === 'function'
        && providerFactory.isAnyProviderConfigured());
}

function asObjectId(id) {
    const raw = String(id || '').trim();
    if (!OBJECT_ID.test(raw)) return null;
    try {
        return new mongoose.Types.ObjectId(raw);
    } catch (_e) {
        return null;
    }
}

async function callerRoleType(companyId, uid) {
    if (!uid) return 3;
    try {
        const row = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [{ userId: String(uid), isDelete: { $ne: true } }, { roleType: 1 }],
        }, 'findOne');
        const role = Number(row && row.roleType);
        return Number.isFinite(role) && role > 0 ? role : 3;
    } catch (_e) {
        return 3;
    }
}

async function visibleProjectIds(companyId, uid) {
    const roleType = await callerRoleType(companyId, uid);
    const restrictProjects = roleType !== 1 && roleType !== 2;
    const filter = { deletedStatusKey: { $ne: 1 } };
    if (restrictProjects) {
        filter.$or = [
            { isPrivateSpace: { $ne: true } },
            { AssigneeUserId: String(uid) },
        ];
    }
    const projects = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [filter, '_id AssigneeUserId', { sort: { updatedAt: -1 }, limit: 80 }],
    }, 'find').catch(() => []);
    return {
        ids: (projects || []).map((row) => String(row._id)),
        restrictProjects,
        roleType,
    };
}

async function loadPeople(companyId, project) {
    const memberIds = [...new Set((project && Array.isArray(project.AssigneeUserId) ? project.AssigneeUserId : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean))];
    const members = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [{ isDelete: { $ne: true } }, { userId: 1, userEmail: 1 }],
    }, 'find').catch(() => []);
    const companyIds = [...new Set((members || []).map((row) => String(row.userId || '')).filter(Boolean))];
    const allowedIds = memberIds.length ? memberIds.filter((id) => companyIds.includes(id)) : companyIds;
    if (!allowedIds.length) return [];

    const objectIds = allowedIds.map(asObjectId).filter(Boolean);
    const users = objectIds.length ? await MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: SCHEMA_TYPE.USERS,
        data: [{ _id: { $in: objectIds } }, { Employee_Name: 1, Employee_Email: 1 }],
    }, 'find').catch(() => []) : [];
    const nameById = {};
    (users || []).forEach((row) => {
        nameById[String(row._id)] = {
            name: row.Employee_Name || '',
            email: row.Employee_Email || '',
        };
    });
    const emailById = {};
    (members || []).forEach((row) => {
        if (row.userId) emailById[String(row.userId)] = row.userEmail || '';
    });
    return allowedIds.map((id) => ({
        id,
        name: (nameById[id] && nameById[id].name) || '',
        email: (nameById[id] && nameById[id].email) || emailById[id] || '',
    }));
}

async function gatherAutofillContext({ companyId, uid, taskId }) {
    const oid = asObjectId(taskId);
    if (!companyId || !oid) {
        return { allowed: false, reason: 'companyId and a valid task id are required.' };
    }

    const task = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ _id: oid, deletedStatusKey: { $ne: 1 } }],
    }, 'findOne').catch(() => null);
    if (!task) return { allowed: false, reason: 'Task not found.' };

    const visible = await visibleProjectIds(companyId, uid);
    const projectId = String(task.ProjectID || '');
    if (visible.restrictProjects && !visible.ids.includes(projectId)) {
        return { allowed: false, reason: 'Task not found.' };
    }

    const projectOid = asObjectId(projectId);
    const project = projectOid ? await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [{ _id: projectOid, deletedStatusKey: { $ne: 1 } }],
    }, 'findOne').catch(() => null) : null;

    const [customFieldPerm, assigneePerm] = await Promise.all([
        evaluatePermission(companyId, uid, 'task.task_custom_field'),
        evaluatePermission(companyId, uid, 'task.task_assignee'),
    ]);
    const permissions = {
        customField: customFieldPerm,
        assignee: assigneePerm,
        uid: String(uid || ''),
        roleType: visible.roleType,
    };
    const gate = permissionGate(permissions);
    if (!gate.allowed) return { allowed: false, reason: gate.reason, permissions, task, companyId };

    const fields = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.CUSTOM_FIELDS,
        data: [{ type: 'task', isDelete: { $ne: false } }],
    }, 'find').catch(() => []);

    const comments = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMMENTS,
        data: [{
            $or: [{ taskId: String(task._id) }, { TaskId: String(task._id) }, { taskId: oid }, { TaskId: oid }],
            isDeleted: { $ne: true },
        }, 'message text createdAt', { sort: { createdAt: -1 }, limit: 12 }],
    }, 'find').catch(() => []);

    const pages = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PAGES,
        data: [{
            linkedTasks: oid,
            deletedStatusKey: 0,
            $or: [{ visibility: { $ne: 'private' } }, { createdBy: String(uid || '') }],
        }, 'title rawText visibility createdBy', { sort: { updatedAt: -1 }, limit: 4 }],
    }, 'find').catch(() => []);

    const people = await loadPeople(companyId, project);
    return {
        allowed: true,
        companyId,
        uid,
        task,
        project,
        fields: fields || [],
        comments: comments || [],
        pages: pages || [],
        people,
        permissions,
        description: descriptionText(task),
    };
}

async function chatSuggestions({ systemPrompt, userPrompt }) {
    if (!isAiConfigured()) return null;
    let provider;
    try {
        provider = providerFactory.getProvider();
    } catch (error) {
        logger.error(`task autofill provider: ${error && error.message ? error.message : error}`);
        return null;
    }
    try {
        const result = await Promise.race([
            provider.chat({
                messages: [{ role: 'user', content: userPrompt }],
                systemPrompt,
                jsonMode: true,
                temperature: 0.2,
                maxTokens: AUTOFILL_MAX_TOKENS,
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('AI request timed out.')), REQUEST_TIMEOUT_MS)),
        ]);
        return parseSuggestionsPayload(result && result.content);
    } catch (error) {
        logger.error(`task autofill LLM failed: ${error && error.message ? error.message : error}`);
        return null;
    }
}

async function previewAutofill(context, options = {}) {
    if (!context || context.allowed === false) {
        return { status: false, reason: (context && context.reason) || 'Task not found.', data: { apply: false, suggestions: [] } };
    }
    const title = String((context.task && context.task.TaskName) || '');
    const description = context.description || descriptionText(context.task);
    const targets = listEmptyTargets(context);
    const base = {
        task: context.task,
        fields: context.fields,
        people: context.people,
        permissions: context.permissions,
        comments: context.comments,
        pages: context.pages,
        description,
    };
    if (!targets.length) return previewFromParts(base, []);

    let proposed = null;
    if (typeof options.chat === 'function') {
        const userPrompt = buildAutofillPrompt({
            task: context.task,
            targets,
            people: context.people,
            description,
            comments: context.comments,
            pages: context.pages,
        });
        proposed = await options.chat({ systemPrompt: AUTOFILL_SYSTEM, userPrompt });
    } else {
        proposed = await chatSuggestions({
            systemPrompt: AUTOFILL_SYSTEM,
            userPrompt: buildAutofillPrompt({
                task: context.task,
                targets,
                people: context.people,
                description,
                comments: context.comments,
                pages: context.pages,
            }),
        });
    }
    if (!Array.isArray(proposed)) {
        proposed = heuristicSuggestions({
            targets,
            people: context.people,
            title,
            description,
            comments: context.comments,
            pages: context.pages,
            task: context.task,
        });
    }
    return previewFromParts(base, proposed);
}

async function writeCustomField(companyId, taskId, fieldId, updateDetail) {
    const oid = asObjectId(taskId);
    const result = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [
            {
                _id: oid,
                $or: [
                    { [`customField.${fieldId}`]: { $exists: false } },
                    { [`customField.${fieldId}.fieldValue`]: { $exists: false } },
                    { [`customField.${fieldId}.fieldValue`]: null },
                    { [`customField.${fieldId}.fieldValue`]: '' },
                    { [`customField.${fieldId}.fieldValue`]: [] },
                    { [`customField.${fieldId}.fieldValue`]: 'DD/MM/YYYY' },
                    { [`customField.${fieldId}.fieldValue`]: 'MM/DD/YYYY' },
                    { [`customField.${fieldId}.fieldValue`]: 'YYYY/MM/DD' },
                    { [`customField.${fieldId}.fieldValue`]: 'YYYY-MM-DD' },
                    { [`customField.${fieldId}.fieldValue`]: {} },
                ],
            },
            { $set: { [`customField.${fieldId}`]: updateDetail } },
            { returnDocument: 'after' },
        ],
    }, 'findOneAndUpdate');
    if (result) {
        socketEmitter.emit('update', {
            type: 'update',
            data: result,
            updatedFields: { [`customField.${fieldId}`]: updateDetail },
            module: 'task',
        });
    }
    return result;
}

async function writeAssignee(companyId, taskId, userIds) {
    const oid = asObjectId(taskId);
    const result = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [
            {
                _id: oid,
                $or: [
                    { AssigneeUserId: { $exists: false } },
                    { AssigneeUserId: { $size: 0 } },
                    { AssigneeUserId: [] },
                ],
            },
            { $set: { AssigneeUserId: userIds } },
            { returnDocument: 'after' },
        ],
    }, 'findOneAndUpdate');
    if (result) {
        socketEmitter.emit('update', {
            type: 'update',
            data: result,
            updatedFields: { AssigneeUserId: userIds },
            module: 'task',
        });
    }
    return result;
}

async function writeDueDate(companyId, taskId, value) {
    const oid = asObjectId(taskId);
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const result = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [
            {
                _id: oid,
                $or: [
                    { DueDate: { $exists: false } },
                    { DueDate: null },
                    { DueDate: '' },
                    { DueDate: 0 },
                ],
            },
            { $set: { DueDate: date } },
            { returnDocument: 'after' },
        ],
    }, 'findOneAndUpdate');
    if (result) {
        socketEmitter.emit('update', {
            type: 'update',
            data: result,
            updatedFields: { DueDate: date },
            module: 'task',
        });
    }
    return result;
}

async function applyAutofillWrites({ companyId, task, suggestions }) {
    // S3.2 trigger write-back should call this after preview. This module does not run triggers.
    const writes = planAutofillWrites(suggestions);
    const applied = [];
    const skipped = [];
    const taskId = recordId(task);
    for (const write of writes) {
        try {
            if (write.type === 'assignee') {
                const result = await writeAssignee(companyId, taskId, write.value);
                if (result) applied.push({ fieldId: NATIVE_ASSIGNEE_ID, kind: 'owner' });
                else skipped.push({ fieldId: NATIVE_ASSIGNEE_ID, reason: 'filled' });
            } else if (write.type === 'dueDate') {
                const result = await writeDueDate(companyId, taskId, write.value);
                if (result) applied.push({ fieldId: NATIVE_DUE_ID, kind: 'date' });
                else skipped.push({ fieldId: NATIVE_DUE_ID, reason: 'filled' });
            } else {
                const result = await writeCustomField(companyId, taskId, write.fieldId, write.updateDetail);
                if (result) {
                    applied.push({ fieldId: write.fieldId });
                    if (write.alsoDueDate && isDueDateEmpty(task)) {
                        await writeDueDate(companyId, taskId, write.updateDetail.fieldValue);
                    }
                } else skipped.push({ fieldId: write.fieldId, reason: 'filled' });
            }
        } catch (error) {
            logger.error(`task autofill write failed: ${error && error.message ? error.message : error}`);
            skipped.push({ fieldId: write.fieldId, reason: 'write-failed' });
        }
    }
    return { applied, skipped };
}

async function applyAutofill(context, incoming) {
    if (!context || context.allowed === false) {
        return { status: false, reason: (context && context.reason) || 'Task not found.', data: { apply: true, applied: [] } };
    }
    const targets = listEmptyTargets(context);
    const sanitized = sanitizeSuggestions(incoming, {
        targets,
        people: context.people,
        task: context.task,
    });
    const { applied, skipped } = await applyAutofillWrites({
        companyId: context.companyId,
        task: context.task,
        suggestions: sanitized.suggestions,
    });
    return {
        status: true,
        data: {
            apply: true,
            applied,
            skipped: [...sanitized.skipped, ...skipped],
            suggestions: sanitized.suggestions.filter((row) => applied.some((item) => item.fieldId === row.fieldId)),
        },
    };
}

module.exports = {
    isAiConfigured,
    isAiAction,
    gatherAutofillContext,
    previewAutofill,
    applyAutofill,
    applyAutofillWrites,
};

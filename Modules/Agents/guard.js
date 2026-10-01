const mongoose = require('mongoose');
const registry = require('./registry');
const audit = require('./agentAudit');
const { resolveActor, isAgent } = require('./actor');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const { readableTaskIds } = require('../Tasks/helpers/taskWritePlacement');

// Middleware that applies the registry to the ordinary REST routes when the
// caller is an agent token. Humans pass straight through — the guard never
// changes what the web app can do.

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const refuse = async (req, res, actor, { action, reason, params, entityId }) => {
    const companyId = req.headers['companyid'] || '';
    const auditId = await audit.recordRefusal(companyId, actor, {
        action, reason, params, entityId, path: `${req.method} ${String(req.originalUrl || '').split('?')[0]}`, ip: req.ip || '',
    });
    return res.status(403).json({ status: false, message: reason, statusText: reason, auditId });
};

const withActor = (fn) => async (req, res, next) => {
    try {
        if (!req.apiToken && !req.agentRun) return next();
        const actor = req.agentActor || await resolveActor(req);
        req.agentActor = actor;
        if (!isAgent(actor)) return next();
        return await fn(req, res, next, actor);
    } catch (e) {
        logger.error(`agent guard: ${e.message}`);
        return res.status(500).json({ status: false, message: 'Agent guard failed.' });
    }
};

const idText = (value) => {
    const named = value && typeof value === 'object' ? (value.id || value._id) : value;
    return typeof named === 'string' && OBJECT_ID.test(named.trim()) ? named.trim().toLowerCase() : '';
};

const storedRow = (companyId, type, id, fields) => (idText(id)
    ? MongoDbCrudOpration(companyId, { type, data: [{ _id: new mongoose.Types.ObjectId(idText(id)) }, fields] }, 'findOne')
    : null);

/* The project of a task the person behind the token can open; a task they cannot open reads as a missing one. */
const projectOfTask = async (companyId, uid, taskId) => {
    if (!(await readableTaskIds(companyId, uid, [idText(taskId)])).length) return '';
    const task = await storedRow(companyId, SCHEMA_TYPE.TASKS, taskId, { ProjectID: 1 });
    return task && task.ProjectID ? String(task.ProjectID).toLowerCase() : '';
};

const flatStatus = (row) => (row && row.convertStatus ? row.convertStatus : row);

/* A status is judged as its project defines it, whatever type and name the body gives it. */
const storedStatus = async (companyId, projectId, statusKey) => {
    const project = await storedRow(companyId, SCHEMA_TYPE.PROJECTS, projectId, { taskStatusData: 1 });
    const rows = ((project && project.taskStatusData) || []).map(flatStatus).filter(Boolean);
    const row = statusKey === undefined || statusKey === null ? null : rows.find((status) => String(status.key) === String(statusKey));
    return row ? { statusType: row.type, name: row.name } : {};
};

const fields = (...names) => (body, { taskId }) => ({ action: 'task.update', params: { taskId, fields: Object.fromEntries(names.map((name) => [name, 1])) } });

const ARCHIVE_ACTIONS = { 0: 'task.restore', 2: 'task.archive' };

/* The registry key, or keys, each task action is; every one must be allowed. An action absent here is refused. */
const TASK_PATCH_ACTIONS = {
    updateStatus: async (body, { companyId, uid, taskId }) => {
        const sent = body.newStatus && typeof body.newStatus === 'object' ? body.newStatus : {};
        const stored = await storedStatus(companyId, await projectOfTask(companyId, uid, taskId), sent.statusKey);
        return [stored, { statusType: sent.statusType, name: sent.status && sent.status.text }]
            .map((status) => ({ action: 'task.status.set', params: { taskId, status } }));
    },
    updateAssignee: (body, { taskId }) => ({ action: 'task.assign', params: { taskId } }),
    updatePriority: fields('Task_Priority'),
    updateDueDate: fields('DueDate'),
    updateStartDate: fields('startDate'),
    updateStartDateAndDueDate: fields('startDate', 'DueDate'),
    updateDates: fields('startDate', 'DueDate'),
    updateDescription: fields('description'),
    updateTaskName: fields('TaskName'),
    updatePoints: fields('points'),
    updateTaskTotalEstimate: fields('totalEstimatedTime'),
    updateChecklists: fields('checklistArray'),
    updateTags: fields('tagsArray'),
    moveTask: async (body, { companyId, uid, taskId }) => {
        const home = await projectOfTask(companyId, uid, taskId);
        const stays = Boolean(home) && idText(body.projectData && body.projectData.id) === home;
        return { action: stays ? 'task.sprint.move' : 'task.move', params: { taskId } };
    },
    updateArchiveDelete: (body, { taskId }) => ({ action: ARCHIVE_ACTIONS[body.deletedStatusKey === undefined ? 0 : body.deletedStatusKey] || 'task.delete', params: { taskId } }),
};

const taskPatchChecks = async (body, at) => {
    const name = typeof body.action === 'string' ? body.action : '';
    if (!Object.hasOwn(TASK_PATCH_ACTIONS, name)) return [{ action: `tasks.${name || 'unknown'}`, params: { taskId: at.taskId } }];
    return [].concat(await TASK_PATCH_ACTIONS[name](body, at));
};

/* An action behind a flag reaches a task through its MCP tool alone, where the token's grant, the
 * workspace's proposal policy and the undo record apply; a task route has none of the three. */
const evaluateOnRoute = (action, params) => {
    const check = registry.evaluate(action, params);
    if (check.allowed && !registry.ACTIONS.includes(check.action)) return { allowed: false, reason: `Agents cannot perform ${action} on this route` };
    return check;
};

/* `taskIdOf(body)` is the task the route's own preparation will write. */
const taskPatchGuard = (taskIdOf) => withActor(async (req, res, next, actor) => {
    const companyId = req.headers['companyid'] || '';
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const checks = await taskPatchChecks(body, { companyId, uid: req.uid, taskId: taskIdOf(body) });
    for (const { action, params } of checks) {
        const check = evaluateOnRoute(action, params);
        if (!check.allowed) return refuse(req, res, actor, { action, reason: check.reason, params, entityId: params.taskId });
    }
    const [{ action, params }] = checks;
    let auditId;
    try {
        auditId = await audit.openAction(companyId, actor, { action, reason: 'via REST', params, entityId: params.taskId, ip: req.ip || '' });
    } catch (e) {
        return res.status(503).json({ status: false, message: e.message, statusText: audit.AUDIT_UNAVAILABLE });
    }
    res.on('finish', () => {
        const settle = res.statusCode >= 400
            ? audit.failAction(companyId, auditId, `HTTP ${res.statusCode}`)
            : audit.applyAction(companyId, auditId, { undo: null });
        settle.catch((e) => logger.error(`agent guard: ${e.message}`));
    });
    return next();
});

/* The perimeter: paths no agent token may reach whatever the body says. These
 * correspond to the actions absent from the registry. */
const PERIMETER = [
    { test: (m) => m === 'DELETE', action: 'delete' },
    { test: (m, p) => /\/company\/delete|\/project-close|\/projectClose/i.test(p), action: 'project.delete' },
    { test: (m, p) => /\/api\/v2\/tasks\/bulk|mergeDuplicate/i.test(p), action: 'task.delete' },
    { test: (m, p) => /chargebee|subscription|invoice|billing|milestone|refundamount|paymentplan|customer-update/i.test(p), action: 'billing.*' },
    { test: (m, p) => m !== 'GET' && /\/api\/v1\/members|\/teams|\/company-invitation|\/root-members/i.test(p), action: 'member.remove' },
    { test: (m, p) => m !== 'GET' && /securityPermissions|\/setting\/roles|\/sso\/|\/scim\//i.test(p), action: 'permissions.edit' },
    { test: (m, p) => /\/deploy|\/git\/merge/i.test(p), action: 'deploy.production' },
    { test: (m, p) => m !== 'GET' && /\/api\/v2\/api-tokens/i.test(p) && !/\/me$/.test(p), action: 'token.manage' },
];

const agentPerimeter = withActor(async (req, res, next, actor) => {
    const path = String(req.originalUrl || req.path || '').split('?')[0];
    const hit = PERIMETER.find((r) => r.test(req.method, path));
    if (!hit) return next();
    const body = req.body || {};
    if (hit.action === 'delete' || body.action === 'deleteTask') {
        return refuse(req, res, actor, { action: hit.action === 'delete' ? `${/task/i.test(path) ? 'task' : 'project'}.delete` : 'task.delete', reason: `Agents cannot perform ${/task/i.test(path) ? 'task.delete' : 'project.delete'}`, params: {} });
    }
    return refuse(req, res, actor, { action: hit.action, reason: `Agents cannot perform ${hit.action}`, params: {} });
});

module.exports = { taskPatchGuard, agentPerimeter, TASK_PATCH_ACTIONS };

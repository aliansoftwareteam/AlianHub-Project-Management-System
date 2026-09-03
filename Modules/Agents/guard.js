const registry = require('./registry');
const audit = require('./agentAudit');
const { resolveActor, isAgent } = require('./actor');
const logger = require('../../Config/loggerConfig');

// Middleware that applies the registry to the ordinary REST routes when the
// caller is an agent token. Humans pass straight through — the guard never
// changes what the web app can do.

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
        return fn(req, res, next, actor);
    } catch (e) {
        logger.error(`agent guard: ${e.message}`);
        return res.status(500).json({ status: false, message: 'Agent guard failed.' });
    }
};

/* Any route that must be a person: reject agents outright. */
const requireHumanActor = withActor((req, res, next, actor) =>
    refuse(req, res, actor, { action: req.body && req.body.action ? String(req.body.action) : 'human-only route', reason: 'Agents cannot perform this action — a person has to.', params: {} }));

/* A route that is one named registry action. */
const agentActionGuard = (action, paramsOf = () => ({})) => withActor(async (req, res, next, actor) => {
    const params = paramsOf(req) || {};
    const check = registry.evaluate(action, params);
    if (!check.allowed) return refuse(req, res, actor, { action, reason: check.reason, params, entityId: params.taskId });
    req.agentAction = { action, params };
    return next();
});

/* PATCH /api/v2/tasks carries many actions in body.action. Map each to a
 * registry key so setting Done, deleting, or anything unmapped is refused. */
const TASK_PATCH_ACTIONS = {
    updateStatus: (b) => ({ action: 'task.status.set', params: { taskId: b.prevStatus && b.prevStatus.taskId, status: { statusType: b.newStatus && b.newStatus.statusType, name: b.newStatus && b.newStatus.status && b.newStatus.status.text } } }),
    updateAssignee: (b) => ({ action: 'task.assign', params: { taskId: taskIdOf(b) } }),
    updatePriority: (b) => ({ action: 'task.update', params: { taskId: taskIdOf(b), fields: { Task_Priority: 1 } } }),
    updateDueDate: (b) => ({ action: 'task.update', params: { taskId: taskIdOf(b), fields: { DueDate: 1 } } }),
    updateStartDate: (b) => ({ action: 'task.update', params: { taskId: taskIdOf(b), fields: { startDate: 1 } } }),
    updateDescription: (b) => ({ action: 'task.update', params: { taskId: taskIdOf(b), fields: { description: 1 } } }),
    updateTaskName: (b) => ({ action: 'task.update', params: { taskId: taskIdOf(b), fields: { TaskName: 1 } } }),
    updatePoints: (b) => ({ action: 'task.update', params: { taskId: taskIdOf(b), fields: { points: 1 } } }),
    updateTaskTotalEstimate: (b) => ({ action: 'task.update', params: { taskId: taskIdOf(b), fields: { totalEstimatedTime: 1 } } }),
    updateChecklist: (b) => ({ action: 'task.update', params: { taskId: taskIdOf(b), fields: { checklistArray: 1 } } }),
    updateTags: (b) => ({ action: 'task.update', params: { taskId: taskIdOf(b), fields: { tagsArray: 1 } } }),
    moveTask: (b) => ({ action: 'task.sprint.move', params: { taskId: taskIdOf(b) } }),
};

const taskIdOf = (b) => (b && ((b.task && b.task._id) || (b.taskData && b.taskData._id) || b.taskId || (b.prevStatus && b.prevStatus.taskId))) || null;

const taskPatchActionOf = (body) => {
    const name = body && body.action;
    const map = name && TASK_PATCH_ACTIONS[name];
    if (!map) return { action: `tasks.${name || 'unknown'}`, params: { taskId: taskIdOf(body) } };
    return map(body);
};

const taskPatchGuard = withActor(async (req, res, next, actor) => {
    const { action, params } = taskPatchActionOf(req.body || {});
    const check = registry.evaluate(action, params);
    if (!check.allowed) return refuse(req, res, actor, { action, reason: check.reason, params, entityId: params.taskId });
    req.agentAction = { action, params };
    res.on('finish', () => {
        if (res.statusCode >= 400) return;
        audit.recordAction(req.headers['companyid'] || '', actor, {
            action, reason: 'via REST', params, entityId: params.taskId, ip: req.ip || '', undo: null,
        }).catch(() => {});
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

module.exports = { requireHumanActor, agentActionGuard, taskPatchGuard, taskPatchActionOf, agentPerimeter, TASK_PATCH_ACTIONS };

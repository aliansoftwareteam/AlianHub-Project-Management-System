const mongoose = require('mongoose');
const registry = require('./registry');
const projectPolicy = require('./projectPolicy');
const audit = require('./agentAudit');
const { resolveActor, isAgent, attribution } = require('./actor');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const { readableTaskIds } = require('../Tasks/helpers/taskWritePlacement');
const { canReadProject, fieldsOf } = require('../../Config/projectAccess');
const { refuse } = require('./personDecides');

// Middleware that applies the registry to the ordinary REST routes when the
// caller is an agent token. Humans pass straight through — the guard never
// changes what the web app can do.

const OBJECT_ID = /^[a-f0-9]{24}$/i;

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

/* A route cannot file a proposal, so what a project holds for a person is refused here and named as the MCP tool's to file. */
const heldOnRoute = (rule) => (rule.decision === projectPolicy.DECISION.PROPOSE ? `${rule.reason}, and a route cannot propose one: the agent's MCP tool files it for approval` : rule.reason);

const plain = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const named = (value) => [].concat(value === undefined || value === null ? [] : value).map((entry) => idText(entry) || String(entry || '')).filter(Boolean);

/* What a task an agent files may carry besides where it lands: the fields task.update lets it write afterwards. */
const FILED_FIELDS = new Set([
    ...registry.get('task.update').fields,
    'CompanyId', 'ProjectID', 'sprintId', 'sprintArray', 'folderObjId', 'ParentTaskId', 'isParentTask',
    'status', 'statusKey', 'statusType', 'TaskType', 'TaskTypeKey', 'AssigneeUserId', 'Task_Leader', 'watchers', 'deletedStatusKey',
]);
const OPENING_STATUS_TYPE = 'default_active';

/* The project a new task names, when the person behind the token can open it; one they cannot open reads as a missing one. */
const openProjectOf = async (companyId, uid, projectId) => {
    if (!idText(projectId) || !(await canReadProject(companyId, uid, idText(projectId))).allowed) return null;
    return storedRow(companyId, SCHEMA_TYPE.PROJECTS, projectId, { taskStatusData: 1, taskTypeCounts: 1 });
};

/* The fields of a new task that task.create does not cover: someone assigned, led or watching other than the
 * person behind the token, a status other than the project's opening one, a type other than its first. */
const fieldsBeyondFiling = async (companyId, uid, data) => {
    const beyond = Object.keys(data).filter((field) => !FILED_FIELDS.has(field));
    if (named(data.AssigneeUserId).length) beyond.push('AssigneeUserId');
    ['Task_Leader', 'watchers'].forEach((field) => { if (named(data[field]).some((id) => id !== String(uid).toLowerCase())) beyond.push(field); });
    if (data.deletedStatusKey !== undefined && data.deletedStatusKey !== 0) beyond.push('deletedStatusKey');

    const sentStatus = plain(data.status);
    const statusKey = data.statusKey === undefined ? sentStatus.key : data.statusKey;
    const sentTypes = [data.statusType, sentStatus.type].filter((type) => type !== undefined);
    const namesStatus = statusKey !== undefined || sentTypes.length > 0 || data.status !== undefined;
    const namesType = data.TaskType !== undefined || data.TaskTypeKey !== undefined;
    if (!namesStatus && !namesType) return beyond;

    const project = await openProjectOf(companyId, uid, data.ProjectID);
    const statuses = ((project && project.taskStatusData) || []).map(flatStatus).filter(Boolean);
    const stored = statuses.find((status) => String(status.key) === String(statusKey));
    const opening = Boolean(stored) && stored.type === OPENING_STATUS_TYPE && sentTypes.every((type) => type === OPENING_STATUS_TYPE)
        && (sentStatus.key === undefined || String(sentStatus.key) === String(statusKey));
    if (namesStatus && !opening) beyond.push('status');

    const [firstType] = (project && project.taskTypeCounts) || [];
    const sameType = Boolean(firstType)
        && (data.TaskTypeKey === undefined || String(data.TaskTypeKey) === String(firstType.key))
        && (data.TaskType === undefined || String(data.TaskType) === String(firstType.value));
    if (namesType && !sameType) beyond.push('TaskType');
    return beyond;
};

const taskCreateChecks = async (req, body, companyId) => {
    const data = plain(body.data);
    const kind = idText(data.ParentTaskId) ? 'subtask' : 'task';
    const params = { projectId: idText(data.ProjectID), ...(kind === 'subtask' ? { taskId: idText(data.ParentTaskId) } : {}) };
    const beyond = await fieldsBeyondFiling(companyId, req.uid, data);
    if (!beyond.length) return { action: `${kind}.create`, params };
    return { action: `${kind}.add`, params: { ...params, fields: Object.fromEntries(beyond.map((field) => [field, 1])) } };
};

const RELATION_ROUTE_ACTIONS = { list: 'task.get', openBlockers: 'task.get', add: 'task.relation.add', remove: 'task.relation.remove' };

const relationChecks = (req, body) => {
    const name = typeof body.action === 'string' && Object.hasOwn(RELATION_ROUTE_ACTIONS, body.action) ? body.action : '';
    return { action: name ? RELATION_ROUTE_ACTIONS[name] : 'task.relation.unknown', params: { taskId: idText(body.taskId) } };
};

/* What a doc an agent drafts may carry, which is what page.draft takes. The company is here because clients
 * send it on every route; the page handlers take theirs from the header. */
const DRAFTED_PAGE_FIELDS = new Set(['title', 'projectId', 'linkedTasks', 'contentBlocks', 'createdByAgent', 'agentName', 'companyId', 'CompanyId']);

const pageCreateChecks = (req, body) => {
    const beyond = Object.keys(body).filter((field) => !DRAFTED_PAGE_FIELDS.has(field));
    if (Array.isArray(body.linkedTasks) && body.linkedTasks.length > 1) beyond.push('linkedTasks');
    const params = { projectId: idText(body.projectId) };
    if (!beyond.length) return { action: 'page.draft', params };
    return { action: 'page.create', params: { ...params, fields: Object.fromEntries(beyond.map((field) => [field, 1])) } };
};

/* What the handler answered, once it has: the handlers behind these routes answer most failures as HTTP 200
 * with `status: false`, so the HTTP status alone does not say whether the write happened. */
const answerOf = (res) => {
    const answer = {};
    ['send', 'json'].filter((name) => typeof res[name] === 'function').forEach((name) => {
        const original = res[name];
        res[name] = function answered(body, ...rest) {
            if (answer.body === undefined && body && typeof body === 'object' && !Buffer.isBuffer(body)) answer.body = body;
            return original.call(this, body, ...rest);
        };
    });
    return answer;
};

const failureOf = (res, answer) => {
    if (res.statusCode >= 400) return `HTTP ${res.statusCode}`;
    const body = answer.body || {};
    return body.status === false ? String(body.statusText || body.message || 'status false') : '';
};

/* `checksOf(req, body, companyId)` names the registry action, or actions, the request is; every one must be
 * allowed without a flag. A write is recorded, a read is not. */
const routeGuard = (checksOf) => withActor(async (req, res, next, actor) => {
    const companyId = req.headers['companyid'] || '';
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const checks = [].concat(await checksOf(req, body, companyId));
    let writes = false;
    for (const { action, params } of checks) {
        const check = evaluateOnRoute(action, params);
        if (!check.allowed) return refuse(req, res, actor, { action, reason: check.reason, params, entityId: params.taskId });
        writes = writes || Boolean(check.action.write);
    }
    if (!writes) return next();
    for (const { action, params } of checks) {
        const rule = await projectPolicy.ask({ companyId, actor, action, params });
        if (rule.decision !== projectPolicy.DECISION.ACT) return refuse(req, res, actor, { action, reason: heldOnRoute(rule), params, entityId: params.taskId });
    }
    const [{ action, params }] = checks;
    let auditId;
    try {
        auditId = await audit.openAction(companyId, actor, { action, reason: 'via REST', params, entityId: params.taskId, ip: req.ip || '' });
    } catch (e) {
        return res.status(503).json({ status: false, message: e.message, statusText: audit.AUDIT_UNAVAILABLE });
    }
    const answer = answerOf(res);
    res.on('finish', () => {
        const failure = failureOf(res, answer);
        const settle = failure
            ? audit.failAction(companyId, auditId, failure)
            : audit.applyAction(companyId, auditId, { undo: null });
        settle.catch((e) => logger.error(`agent guard: ${e.message}`));
    });
    return next();
});

/* `taskIdOf(body)` is the task the route's own preparation will write. */
const taskPatchGuard = (taskIdOf) => routeGuard((req, body, companyId) => taskPatchChecks(body, { companyId, uid: req.uid, taskId: taskIdOf(body) }));
const taskCreateGuard = routeGuard(taskCreateChecks);
const relationGuard = routeGuard(relationChecks);

const pageCreateChecked = routeGuard(pageCreateChecks);

/* A doc an agent creates is its draft whatever the body says, so that a person signs it off. */
const pageCreateGuard = (req, res, next) => pageCreateChecked(req, res, () => {
    if (isAgent(req.agentActor)) req.agentDraft = { agentName: attribution(req.agentActor).label };
    return next();
});

/* For a write route the registry has no action for, or only one behind a flag: `action` names it in the refusal and its audit row. */
const agentsRefused = (action) => routeGuard(() => ({ action, params: {} }));

/* What the project update moves a project with: the trash, the archive and the way back, and its open or closed state. */
const PROJECT_MOVES = { deletedStatusKey: 'project.delete', status: 'project.status.set', statusType: 'project.status.set' };
const projectMoveRefused = Object.fromEntries([...new Set(Object.values(PROJECT_MOVES))].map((action) => [action, agentsRefused(action)]));

/* An agent changes a project's other details as its person may; where the project sits is a person's to change. */
const projectUpdateGuard = (req, res, next) => {
    const move = fieldsOf(req.body && req.body.updateObject).map((field) => PROJECT_MOVES[field]).find(Boolean);
    return move ? projectMoveRefused[move](req, res, next) : next();
};

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const WORD = /^[a-z][a-z-]*$/;
const sourcesAlone = (body) => Object.keys(body).length === 1 && body.sources !== undefined;

/* The action each goal write is, by its method and its path below the goal routes, `:id` standing for an id. */
const GOAL_WRITES = {
    'POST /': 'goal.create',
    'PATCH /:id': 'goal.update',
    'POST /:id/archive': 'goal.archive',
    'POST /:id/restore': 'goal.restore',
    'POST /:id/targets': 'goal.target.add',
    'PATCH /:id/targets/:id': (body) => (sourcesAlone(body) ? ['goal.target.sources.add', 'goal.target.sources.remove'] : 'goal.target.edit'),
    'DELETE /:id/targets/:id': 'goal.target.remove',
    'PUT /:id/targets/:id/value': 'goal.target.set',
};

/* A goal write that is not listed is still judged, under the name of its last word, so a route added later is
 * closed to an agent token until it is given an action here. */
const goalChecks = (req, body) => {
    const segments = String(req.url || '').split('?')[0].split('/').filter(Boolean);
    const ids = segments.filter((segment) => OBJECT_ID.test(segment));
    const listed = GOAL_WRITES[`${req.method} /${segments.map((segment) => (OBJECT_ID.test(segment) ? ':id' : segment)).join('/')}`];
    const last = segments[segments.length - 1] || '';
    const actions = listed ? [].concat(typeof listed === 'function' ? listed(body) : listed) : [`goal.${WORD.test(last) ? last : 'write'}`];
    const params = { ...(ids[0] ? { goalId: ids[0] } : {}), ...(ids[1] ? { targetId: ids[1] } : {}) };
    return actions.map((action) => ({ action, params }));
};

const goalWriteGuard = routeGuard(goalChecks);

/* Mounted on the goal routes' prefix, so it runs before every handler under it. */
const goalGuard = (req, res, next) => (READ_METHODS.has(req.method) ? next() : goalWriteGuard(req, res, next));

/* The perimeter: paths no agent token may reach whatever the body says. These
 * correspond to the actions absent from the registry. */
const PERIMETER = [
    { test: (m) => m === 'DELETE', action: 'delete' },
    { test: (m, p) => /\/company\/delete|\/project-close|\/projectClose/i.test(p), action: 'project.delete' },
    { test: (m, p) => /\/api\/v2\/tasks\/bulk|mergeDuplicate/i.test(p), action: 'task.delete' },
    { test: (m, p) => /chargebee|subscription|invoice|billing|milestone|refundamount|paymentplan|customer-update/i.test(p), action: 'billing.*' },
    { test: (m, p) => m !== 'GET' && /\/api\/v1\/members|\/teams|\/company-invitation|\/root-members/i.test(p), action: 'member.remove' },
    { test: (m, p) => m !== 'GET' && /securityPermissions|\/setting\/roles|\/sso\/|\/scim\//i.test(p), action: 'permissions.edit' },
    { test: (m, p) => m !== 'GET' && /\/projectRules\/|\/importSettings(ProjectFunction)?$/i.test(p), action: 'permissions.edit' },
    { test: (m, p) => m !== 'GET' && /\/manageTrackerUserPermission/i.test(p), action: 'member.seat' },
    { test: (m, p) => m !== 'GET' && /\/sendInvitationEmail|\/importUser$/i.test(p), action: 'member.invite' },
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

module.exports = { taskPatchGuard, taskCreateGuard, relationGuard, pageCreateGuard, goalGuard, projectUpdateGuard, agentsRefused, agentPerimeter, TASK_PATCH_ACTIONS };

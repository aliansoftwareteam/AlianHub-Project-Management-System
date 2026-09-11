/**
 * Server-side permission enforcement — the backend counterpart of the
 * frontend `checkPermission()` (frontend/src/composable/index.js) and of what
 * the Security & Permissions matrix shows an admin.
 *
 * WHY: permission/role checks were previously evaluated ONLY in the Vue
 * app. Any API client (curl, scripts, the MCP server) using a valid token
 * could bypass them. This module re-evaluates the SAME rule model on the
 * server. Single source of truth (MCP plan decision D4).
 *
 * Model (mirrors the frontend exactly):
 *   - roleType 1 (owner) and 2 (admin) bypass all permission checks.
 *   - Any other role is evaluated against the company RULES, or the project's
 *     own PROJECT_RULES when that project has isGlobalPermission === false.
 *   - A role with no entry on a rule, or a rule that does not exist, is
 *     null: the matrix shows it as "None".
 *   - null = no access, false = read-only, true = write,
 *     1 | 2 = "Own" | "Everyone" on the selection fields.
 */
const mongoose = require("mongoose");
const { myCache } = require("./config");
const { SCHEMA_TYPE } = require("./schemaType");
const { MongoDbCrudOpration } = require("../utils/mongo-handler/mongoQueries");
const { fetchRules } = require("../Modules/settings/securityPermissions/controller");
const logger = require("./loggerConfig");

const ROLE_OWNER = 1;
const ROLE_ADMIN = 2;
const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const ROLE_CACHE_TTL_SECONDS = 60;
const PROJECT_RULES_TTL_SECONDS = 604800;

// A project's own rules never hold these two keys, and checkPermission(path, false) grants them.
const PROJECT_CONTEXT_GRANTED = ['project.project_list', 'project.public_projects'];

// Ops escape hatch (runbook kill switch): if a fine-grained permission edge
// case ever blocks a legitimate member workflow in production, set
// DISABLE_PERMISSION_ENFORCEMENT=true and restart to bypass the per-KEY
// layer (requirePermission). The role guards (requireRole) for the
// privilege-escalation endpoints stay ON regardless — they are not affected.
const fineGrainedEnforced = () => process.env.DISABLE_PERMISSION_ENFORCEMENT !== 'true';

// HARD ISOLATION (2026-06-15): these guards must NEVER affect the web app.
// Web-app requests authenticate via JWT session and set `req.uid` but NOT
// `req.apiToken`. MCP / PAT requests (Authorization: Bearer ahp_…) set
// `req.apiToken` (see Config/jwt.js verifyApiTokenRequest). Enforcement runs
// ONLY for PAT requests; gating shared web routes once caused false denials
// in production (e.g. assigning a task).
const isApiTokenRequest = (req) => Boolean(req && req.apiToken);

// PATCH /api/v2/tasks dispatches many actions; actions not listed pass
// through (structural ops like moveTask/convert have no single key).
const TASK_ACTION_PERMISSION = {
    updateStatus: 'task.task_status',
    updatePriority: 'task.task_priority',
    updateAssignee: 'task.task_assignee',
    updateDueDate: 'task.task_due_date',
    updateStartDate: 'task.task_due_date',
    updateTaskType: 'task.task_type',
    updateDescription: 'task.task_description',
    updateTaskTotalEstimate: 'task.task_estimated_hours',
    updatePoints: 'task.task_estimated_hours',
};

const toObjectId = (value) => (OBJECT_ID_PATTERN.test(String(value || '')) ? new mongoose.Types.ObjectId(String(value)) : null);

/** Resolve a user's roleType within a company (cached 60s). null if not a member. */
const getRoleType = async (companyId, uid) => {
    if (!companyId || !uid || !OBJECT_ID_PATTERN.test(String(companyId)) || !OBJECT_ID_PATTERN.test(String(uid))) {
        return null;
    }
    const cacheKey = `roleType:${companyId}:${uid}`;
    const cached = myCache.get(cacheKey);
    if (cached !== undefined) return cached;
    try {
        const companyUser = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [{ userId: String(uid) }, { roleType: 1 }],
        }, "findOne");
        const roleType = companyUser && typeof companyUser.roleType === "number" ? companyUser.roleType : null;
        myCache.set(cacheKey, roleType, ROLE_CACHE_TTL_SECONDS);
        return roleType;
    } catch (error) {
        logger.error(`getRoleType error company=${companyId} uid=${uid}: ${error.message || error}`);
        return null;
    }
};

const isPrivileged = (roleType) => roleType === ROLE_OWNER || roleType === ROLE_ADMIN;

/** Arrange the flat RULES array into the nested object the frontend uses. */
const arrangeRules = (rawRules) => {
    const arranged = {};
    const rules = [...(rawRules || [])].sort((a, b) => (a.isParent > b.isParent ? -1 : 1));
    rules.forEach((rule) => {
        const ownKey = rule.key ? rule.key : String(rule.name || "").replaceAll(" ", "_").toLowerCase();
        if (rule.isParent) {
            arranged[ownKey] = { ...rule };
        } else {
            const parent = rules.find((x) => String(x._id) === String(rule.parentId));
            if (parent && parent.key && arranged[parent.key]) {
                arranged[parent.key][ownKey] = rule;
            }
        }
    });
    return arranged;
};

const lookupRule = (arranged, path) => {
    let rule = null;
    for (const segment of String(path).split('.')) {
        rule = rule ? rule[segment] : arranged[segment];
        if (rule === undefined || rule === null) return null;
    }
    return rule && Array.isArray(rule.roles) ? rule : null;
};

/* Same cache key as Modules/projectRules, so an edit there invalidates this too. */
const loadProjectRules = async (companyId, projectId) => {
    const key = `projectRules:${projectId}`;
    const cached = myCache.get(key);
    if (Array.isArray(cached) && cached.length) return cached;
    const rules = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECT_RULES, data: [{ projectId: String(projectId) }] }, 'find');
    myCache.set(key, rules || [], PROJECT_RULES_TTL_SECONDS);
    return rules || [];
};

const rulesFor = async (companyId, projectId) => {
    const id = toObjectId(projectId);
    const project = id
        ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: id }, { isGlobalPermission: 1 }] }, 'findOne')
        : null;
    if (project && project.isGlobalPermission === false) {
        return { arranged: arrangeRules(await loadProjectRules(companyId, projectId)), projectScoped: true };
    }
    return { arranged: arrangeRules(await fetchRules(companyId)), projectScoped: false };
};

/**
 * null | false | true (or 1 | 2 for scoped keys), exactly as the matrix stores it.
 * Throws when the rules cannot be read; callers decide, and every guard refuses.
 */
const evaluatePermission = async (companyId, uid, path, { projectId } = {}) => {
    const roleType = await getRoleType(companyId, uid);
    if (roleType === null) return null;
    if (isPrivileged(roleType)) return true;
    const { arranged, projectScoped } = await rulesFor(companyId, projectId);
    if (projectScoped && PROJECT_CONTEXT_GRANTED.includes(path)) return true;
    const rule = lookupRule(arranged, path);
    if (!rule) return null;
    const match = rule.roles.find((r) => r.key === roleType);
    return match ? match.permission : null;
};

/* A task named in the body decides the project, so a client cannot borrow a more permissive project's rules. */
const projectIdForRequest = async (companyId, req) => {
    const body = (req && req.body) || {};
    const taskId = toObjectId(body.taskData && body.taskData._id);
    if (taskId) {
        const task = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: taskId }, { ProjectID: 1 }] }, 'findOne');
        return task && task.ProjectID ? String(task.ProjectID) : null;
    }
    const direct = [body.data && body.data.ProjectID, body.projectId].find((value) => OBJECT_ID_PATTERN.test(String(value || '')));
    return direct ? String(direct) : null;
};

/**
 * Express middleware: require the caller's roleType to be in `allowed`.
 * Use for owner/admin-only endpoints (settings, members, permissions).
 */
const requireRole = (allowed = [ROLE_OWNER, ROLE_ADMIN]) => async (req, res, next) => {
    if (!isApiTokenRequest(req)) return next();
    try {
        const companyId = req.headers["companyid"] || "";
        const roleType = await getRoleType(companyId, req.uid);
        if (roleType !== null && allowed.includes(roleType)) return next();
        return res.status(403).json({
            status: false,
            statusText: "You do not have permission to perform this action.",
            error: "Forbidden",
        });
    } catch (error) {
        logger.error(`requireRole error: ${error.message || error}`);
        return res.status(403).json({ status: false, statusText: "Permission check failed.", error: "Forbidden" });
    }
};

const isWritable = (permission) => permission === true || permission === 1 || permission === 2;
const isReadable = (permission) => permission !== null && permission !== undefined && permission !== 0;

/**
 * Express middleware: require a permission KEY for the request's project.
 * write:true (default) needs a writable value, write:false any readable one.
 */
const requirePermission = (path, { write = true } = {}) => async (req, res, next) => {
    if (!isApiTokenRequest(req)) return next();
    if (!fineGrainedEnforced()) return next();
    const forbid = (statusText) => res.status(403).json({ status: false, statusText, error: "Forbidden", permission: path });
    try {
        const companyId = req.headers["companyid"] || "";
        const projectId = await projectIdForRequest(companyId, req);
        const permission = await evaluatePermission(companyId, req.uid, path, { projectId });
        if (write ? isWritable(permission) : isReadable(permission)) return next();
        return forbid("You do not have permission to perform this action.");
    } catch (error) {
        logger.error(`requirePermission error (${path}): ${error.message || error}`);
        return forbid("Permission check failed.");
    }
};

const requireTaskActionPermission = () => async (req, res, next) => {
    if (!isApiTokenRequest(req)) return next();
    if (!fineGrainedEnforced()) return next();
    const action = req.body && req.body.action;
    const key = action && TASK_ACTION_PERMISSION[action];
    if (!key) return next();
    return requirePermission(key, { write: true })(req, res, next);
};

/** The permission keys the MCP server enforces (one per tool/field). */
const MCP_PERMISSION_KEYS = [
    'project.project_list',
    'project.project_create',
    'project.project_sprint_create',
    'project.project_folder_create',
    'project.project_name_edit',
    'project.project_description',
    'project.project_details',
    'project.project_assignee',
    'task.task_list',
    'task.task_create',
    'task.task_status',
    'task.task_assignee',
    'task.task_due_date',
    'task.task_priority',
    'task.task_type',
    'task.task_name_edit',
    'task.task_description',
    'task.task_move',
    'task.task_comment',
    'task.task_estimated_hours',
    'sheet_settings.user_timesheet',
    'sheet_settings.workload_timesheet',
];

/**
 * The company-wide effective map { roleType, permissions: { key: value } } the
 * whoami endpoint hands the MCP server at connect time.
 */
const evaluateMany = async (companyId, uid, keys = MCP_PERMISSION_KEYS) => {
    const roleType = await getRoleType(companyId, uid);
    const permissions = {};
    if (roleType === null) {
        keys.forEach((k) => { permissions[k] = null; });
        return { roleType: null, permissions };
    }
    if (isPrivileged(roleType)) {
        keys.forEach((k) => { permissions[k] = true; });
        return { roleType, permissions };
    }
    let arranged = {};
    try {
        arranged = arrangeRules(await fetchRules(companyId));
    } catch (error) {
        logger.error(`evaluateMany fetchRules error: ${error.message || error}`);
    }
    for (const key of keys) {
        const rule = lookupRule(arranged, key);
        const match = rule && rule.roles.find((r) => r.key === roleType);
        permissions[key] = match ? match.permission : null;
    }
    return { roleType, permissions };
};

/** Invalidate the cached roleType (call from member add/remove/role-change flows). */
const invalidateRoleCache = (companyId, uid) => {
    if (companyId && uid) myCache.del(`roleType:${companyId}:${uid}`);
};

module.exports = {
    ROLE_OWNER,
    ROLE_ADMIN,
    getRoleType,
    isPrivileged,
    arrangeRules,
    evaluatePermission,
    requireRole,
    requirePermission,
    requireTaskActionPermission,
    evaluateMany,
    MCP_PERMISSION_KEYS,
    invalidateRoleCache,
    fineGrainedEnforced,
    isWritable,
    isReadable,
};

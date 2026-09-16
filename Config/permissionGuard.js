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
 *   - A role comes from an ACTIVE company seat and nothing else: a pending invitee
 *     and a removed member both keep a company_users row carrying a roleType, and
 *     neither of them is a member.
 *   - roleType 1 (owner) and 2 (admin) bypass all permission checks.
 *   - Every other role, guest (0) included, is evaluated against the company
 *     RULES, or the project's own PROJECT_RULES when that project has
 *     isGlobalPermission === false. settings.* keys always read the company RULES.
 *   - tests/fixtures/permissionParity.json holds the cases both evaluators must
 *     agree on, and the known differences.
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
const { ROLE_GUEST, ROLE_OWNER, ROLE_ADMIN, ROLE_MEMBER, isPrivileged } = require("./roleTypes");
const { ACTIVE_SEAT, INVITED_SEAT } = require("./seatStatus");

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const ROLE_CACHE_TTL_SECONDS = 60;
const PROJECT_RULES_TTL_SECONDS = 604800;

// A project's own rules never hold these two keys, and checkPermission(path, false) grants them.
const PROJECT_CONTEXT_GRANTED = ['project.project_list', 'project.public_projects'];

// Project rules are seeded from the project and task sections only, and the web app never checks a settings key against them.
const isCompanyWideKey = (path) => String(path).startsWith('settings.');

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

/**
 * Which company_users rows a lookup may read. `active` is the only one that answers
 * "what may this caller do": a pending invitee has not accepted yet and a removed member
 * keeps their row, and neither is a member. The other two exist so a flow that must still
 * see such a row says so, and is read as a deliberate exception at the call site.
 */
const SEAT_SCOPES = {
    active: ACTIVE_SEAT,
    invited: INVITED_SEAT,
    any: {},
};

/** Resolve a user's roleType within a company from a live seat (cached 60s). null if not a member. */
const getRoleType = async (companyId, uid, { seat = 'active' } = {}) => {
    if (!companyId || !uid || !OBJECT_ID_PATTERN.test(String(companyId)) || !OBJECT_ID_PATTERN.test(String(uid))) {
        return null;
    }
    const seatFilter = SEAT_SCOPES[seat];
    if (!seatFilter) throw new Error(`getRoleType: unknown seat scope ${seat}`);
    const cacheKey = `roleType:${seat}:${companyId}:${uid}`;
    const cached = myCache.get(cacheKey);
    if (cached !== undefined) return cached;
    try {
        const companyUser = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [{ userId: String(uid), ...seatFilter }, { roleType: 1 }],
        }, "findOne");
        const roleType = companyUser && typeof companyUser.roleType === "number" ? companyUser.roleType : null;
        myCache.set(cacheKey, roleType, ROLE_CACHE_TTL_SECONDS);
        return roleType;
    } catch (error) {
        logger.error(`getRoleType error company=${companyId} uid=${uid}: ${error.message || error}`);
        return null;
    }
};

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

/*
 * The web app reads a missing flag as true (checkPermission's default) and an explicit null as the
 * project rules. Null stays on the company rules here: the project routes enforce this evaluator for
 * every session, so reading the project rules would refuse requests allowed today. Migration 029
 * rewrites stored nulls to true.
 */
const usesProjectRules = (project) => Boolean(project) && project.isGlobalPermission === false;

const rulesFor = async (companyId, projectId) => {
    const id = toObjectId(projectId);
    const project = id
        ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: id }, { isGlobalPermission: 1 }] }, 'findOne')
        : null;
    if (usesProjectRules(project)) {
        return { arranged: arrangeRules(await loadProjectRules(companyId, projectId)), projectScoped: true };
    }
    return { arranged: arrangeRules(await fetchRules(companyId)), projectScoped: false };
};

const permissionIn = ({ arranged, projectScoped }, roleType, path) => {
    if (projectScoped && PROJECT_CONTEXT_GRANTED.includes(path)) return true;
    const rule = lookupRule(arranged, path);
    const match = rule && rule.roles.find((r) => r.key === roleType);
    return match ? match.permission : null;
};

/**
 * null | false | true (or 1 | 2 for scoped keys), exactly as the matrix stores it.
 * Throws when the rules cannot be read; callers decide, and every guard refuses.
 */
const evaluatePermission = async (companyId, uid, path, { projectId } = {}) => {
    const roleType = await getRoleType(companyId, uid);
    if (roleType === null) return null;
    if (isPrivileged(roleType)) return true;
    return permissionIn(await rulesFor(companyId, isCompanyWideKey(path) ? null : projectId), roleType, path);
};

const TASK_ID_FIELDS = [['taskData', '_id'], ['task', '_id']];
const PROJECT_ID_FIELDS = [['data', 'ProjectID'], ['projectData', '_id'], ['project', '_id'], ['projectId']];

const idAt = (body, fields) => {
    const value = fields.reduce((node, field) => (node && typeof node === 'object' ? node[field] : undefined), body);
    return OBJECT_ID_PATTERN.test(String(value || '')) ? String(value) : null;
};
const idsAt = (body, paths) => [...new Set(paths.map((fields) => idAt(body, fields)).filter(Boolean))];

/*
 * The projects whose rules judge a request, from every body shape the web app sends to a guarded route
 * (tests/permission-request-project.test.js). Named tasks decide over named projects and every one of
 * them must allow, so a client cannot borrow a more permissive project's rules. `unresolved` marks a body
 * whose tasks all failed to resolve. `legacyProjectId` is what this lookup returned before it covered the
 * task and project shapes; the enforced API-token path still allows what that project allowed.
 */
const projectsForRequest = async (companyId, req) => {
    const body = (req && req.body) || {};
    const taskIds = idsAt(body, TASK_ID_FIELDS);
    const projectOfTask = new Map();
    if (taskIds.length) {
        const tasks = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ _id: { $in: taskIds.map(toObjectId) } }, { ProjectID: 1 }],
        }, 'find');
        (tasks || []).forEach((task) => { if (task.ProjectID) projectOfTask.set(String(task._id), String(task.ProjectID)); });
    }
    const projectIds = taskIds.length
        ? [...new Set(taskIds.map((id) => projectOfTask.get(id)).filter(Boolean))]
        : idsAt(body, PROJECT_ID_FIELDS);
    const legacyTaskId = idAt(body, ['taskData', '_id']);
    const legacyProjectId = legacyTaskId
        ? (projectOfTask.get(legacyTaskId) || null)
        : (idAt(body, ['data', 'ProjectID']) || idAt(body, ['projectId']));
    return { projectIds, unresolved: taskIds.length > 0 && projectIds.length === 0, legacyProjectId };
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

/**
 * Hard gate for company settings and permission-rule writes, for web sessions and API tokens alike.
 * `permission` names the matching catalogue key; admins pass whatever the matrix says, exactly as
 * the frontend checkPermission() treats them, and every other role is refused.
 */
const requireCompanyAdmin = ({ permission = null } = {}) => async (req, res, next) => {
    const refuse = (statusText) => res.status(403).json({ status: false, statusText, message: 'Forbidden', ...(permission ? { permission } : {}) });
    try {
        const roleType = await getRoleType(req.headers["companyid"] || "", req.uid);
        if (isPrivileged(roleType)) return next();
        return refuse("Only an owner or an admin can change company settings.");
    } catch (error) {
        logger.error(`requireCompanyAdmin error (${permission || 'settings'}): ${error.message || error}`);
        return refuse("Permission check failed.");
    }
};

const isWritable = (permission) => permission === true || permission === 1 || permission === 2;
const isReadable = (permission) => permission !== null && permission !== undefined && permission !== 0;

const passes = (permission, write) => (write ? isWritable(permission) : isReadable(permission));

const allowedInEvery = async (companyId, uid, path, write, projectIds) => {
    for (const projectId of projectIds.length ? projectIds : [null]) {
        if (!passes(await evaluatePermission(companyId, uid, path, { projectId }), write)) return false;
    }
    return true;
};

/*
 * A body whose tasks do not exist is judged on the company rules rather than passed through: the task
 * handlers write through the ids and the company the body names, so it could reach a task this check never saw.
 */
const requestAllowed = async (companyId, uid, req, path, write) => {
    if (isCompanyWideKey(path)) return passes(await evaluatePermission(companyId, uid, path), write);
    const { projectIds, unresolved, legacyProjectId } = await projectsForRequest(companyId, req);
    if (unresolved) logger.warn(`permission guard ${path}: the tasks named in the body were not found; judged on the company rules`);
    if (await allowedInEvery(companyId, uid, path, write, projectIds)) return true;
    const sameContext = projectIds.length <= 1 && (projectIds[0] || null) === legacyProjectId;
    if (sameContext || !passes(await evaluatePermission(companyId, uid, path, { projectId: legacyProjectId }), write)) return false;
    logger.warn(`permission guard ${path}: known difference, refused by project ${projectIds.join(', ') || 'none'} but allowed by ${legacyProjectId || 'the company rules'} as before`);
    return true;
};

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
        if (await requestAllowed(companyId, req.uid, req, path, write)) return next();
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

const NO_RULES = { arranged: {}, projectScoped: false };

/**
 * The effective map { roleType, permissions: { key: value } }, read once for many keys, with the answers
 * evaluatePermission gives. Without a projectId it is company-wide: what the whoami endpoint hands the
 * MCP server at connect time. Unreadable rules answer null for every key.
 */
const evaluateMany = async (companyId, uid, keys = MCP_PERMISSION_KEYS, { projectId } = {}) => {
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
    let scoped = NO_RULES;
    let company = NO_RULES;
    try {
        scoped = await rulesFor(companyId, projectId);
        company = scoped.projectScoped && keys.some(isCompanyWideKey) ? await rulesFor(companyId, null) : scoped;
    } catch (error) {
        scoped = NO_RULES;
        company = NO_RULES;
        logger.error(`evaluateMany rules error: ${error.message || error}`);
    }
    keys.forEach((key) => { permissions[key] = permissionIn(isCompanyWideKey(key) ? company : scoped, roleType, key); });
    return { roleType, permissions };
};

/** Invalidate the cached roleType (call from member add/remove/role-change flows). */
const invalidateRoleCache = (companyId, uid) => {
    if (companyId && uid) Object.keys(SEAT_SCOPES).forEach((seat) => myCache.del(`roleType:${seat}:${companyId}:${uid}`));
};

module.exports = {
    ROLE_GUEST,
    ROLE_OWNER,
    ROLE_ADMIN,
    ROLE_MEMBER,
    getRoleType,
    isPrivileged,
    arrangeRules,
    evaluatePermission,
    projectsForRequest,
    requireRole,
    requireCompanyAdmin,
    requirePermission,
    requireTaskActionPermission,
    evaluateMany,
    MCP_PERMISSION_KEYS,
    invalidateRoleCache,
    fineGrainedEnforced,
    isWritable,
    isReadable,
};

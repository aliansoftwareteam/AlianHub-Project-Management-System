/**
 * Server-side permission enforcement — the backend counterpart of the
 * frontend `checkPermission()` (frontend/src/composable/index.js).
 *
 * WHY: permission/role checks were previously evaluated ONLY in the Vue
 * app. Any API client (curl, scripts, the MCP server) using a valid token
 * could bypass them. This module re-evaluates the SAME rule model on the
 * server so every client — web, MCP, anything — obeys the same roles &
 * permissions. Single source of truth (MCP plan decision D4).
 *
 * Model (mirrors the frontend exactly):
 *   - roleType 1 (owner) and 2 (admin) bypass all permission checks.
 *   - roleType >= 3 is evaluated against the company RULES document.
 *   - The RULES collection is a flat array of rule docs:
 *       { _id, key, name, isParent, parentId, roles: [{ key: roleType,
 *         permission: null | false | true }] }
 *     arranged into { parentKey: { ...parent, childKey: childRule } }
 *     (see frontend mutateArrangedRules). Three-value result:
 *       null  = no access (hidden)   false = read-only   true = write
 */
const mongoose = require("mongoose");
const { myCache } = require("./config");
const { dbCollections } = require("./collections");
const { SCHEMA_TYPE } = require("./schemaType");
const { MongoDbCrudOpration } = require("../utils/mongo-handler/mongoQueries");
const { fetchRules } = require("../Modules/settings/securityPermissions/controller");
const logger = require("./loggerConfig");

const ROLE_OWNER = 1;
const ROLE_ADMIN = 2;
const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const ROLE_CACHE_TTL_SECONDS = 60;

// Ops escape hatch (runbook kill switch): if a fine-grained permission edge
// case ever blocks a legitimate member workflow in production, set
// DISABLE_PERMISSION_ENFORCEMENT=true and restart to bypass the per-KEY
// layer (requirePermission). The role guards (requireRole) for the
// privilege-escalation endpoints stay ON regardless — they are not affected.
const fineGrainedEnforced = () => process.env.DISABLE_PERMISSION_ENFORCEMENT !== 'true';

// HARD ISOLATION (2026-06-15): these guards must NEVER affect the web app.
// Web-app requests authenticate via JWT session and set `req.uid` but NOT
// `req.apiToken`. MCP / PAT requests (Authorization: Bearer ahp_…) set
// `req.apiToken` (see Config/jwt.js verifyApiTokenRequest). We therefore run
// permission/role enforcement ONLY for PAT requests and let every JWT/web
// request fall straight through — so the existing frontend/backend behavior
// is byte-for-byte unchanged. (The backend mirror of frontend checkPermission
// is not yet a perfect match for per-project overrides, so gating shared web
// routes caused false denials in production — e.g. assigning a task.)
const isApiTokenRequest = (req) => Boolean(req && req.apiToken);

// PATCH /api/v2/tasks dispatches many actions; map each to its permission
// key (mirrors the frontend per-field gates). Actions not listed pass
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

/**
 * Evaluate a permission path (e.g. "task.task_status") for a user.
 * Returns null | false | true exactly like the frontend.
 * (Global company rules; project-scoped overrides are a future addition.)
 */
const evaluatePermission = async (companyId, uid, path) => {
    const roleType = await getRoleType(companyId, uid);
    if (roleType === null) return null;
    if (isPrivileged(roleType)) return true;

    let arranged;
    try {
        arranged = arrangeRules(await fetchRules(companyId));
    } catch (error) {
        logger.error(`evaluatePermission fetchRules error: ${error.message || error}`);
        return null;
    }

    let rule = null;
    for (const segment of String(path).split(".")) {
        rule = rule ? rule[segment] : arranged[segment];
        if (rule === undefined || rule === null) return null;
    }
    if (!rule || !Array.isArray(rule.roles)) return null;
    const match = rule.roles.find((r) => r.key === roleType);
    return match ? match.permission : null;
};

/**
 * Express middleware: require the caller's roleType to be in `allowed`.
 * Use for owner/admin-only endpoints (settings, members, permissions).
 * Reads req.uid (set by both the JWT and PAT auth branches) + companyid header.
 */
const requireRole = (allowed = [ROLE_OWNER, ROLE_ADMIN]) => async (req, res, next) => {
    if (!isApiTokenRequest(req)) return next(); // web/JWT requests pass through untouched
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
 * Express middleware: require a permission KEY.
 * - write:true (default) needs permission === true.
 * - write:false (read) needs permission !== null.
 * Owner/admin always pass.
 */
// Normalize heterogeneous permission values to a write/read decision.
// boolean keys: true = read+write, false = read-only, null = none.
// scoped keys: 1 = Own (write own), 2 = Everyone (write all), null/0 = none.
const isWritable = (permission) => permission === true || permission === 1 || permission === 2;
const isReadable = (permission) => permission !== null && permission !== undefined && permission !== 0;

const requirePermission = (path, { write = true } = {}) => async (req, res, next) => {
    if (!isApiTokenRequest(req)) return next(); // web/JWT requests pass through untouched
    if (!fineGrainedEnforced()) return next();
    try {
        const companyId = req.headers["companyid"] || "";
        const permission = await evaluatePermission(companyId, req.uid, path);
        const ok = write ? isWritable(permission) : isReadable(permission);
        if (ok) return next();
        return res.status(403).json({
            status: false,
            statusText: "You do not have permission to perform this action.",
            error: "Forbidden",
            permission: path,
        });
    } catch (error) {
        // Fail-open on internal errors (e.g. transient rules-fetch failure)
        // so a glitch never blocks the whole app; real denials still block.
        logger.error(`requirePermission error (${path}): ${error.message || error}`);
        return next();
    }
};

/**
 * Express middleware for PATCH /api/v2/tasks: enforce the permission key
 * mapped to req.body.action. Unmapped actions pass through.
 */
const requireTaskActionPermission = () => async (req, res, next) => {
    if (!isApiTokenRequest(req)) return next(); // web/JWT requests pass through untouched
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
 * Evaluate many permission keys at once for a user.
 * Returns { roleType, permissions: { key: null|false|true } }.
 * Used by the whoami endpoint so the MCP server gets the full effective
 * permission map in one call at connect time.
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
        let rule = null;
        let ok = true;
        for (const segment of String(key).split('.')) {
            rule = rule ? rule[segment] : arranged[segment];
            if (rule === undefined || rule === null) { ok = false; break; }
        }
        if (ok && rule && Array.isArray(rule.roles)) {
            const match = rule.roles.find((r) => r.key === roleType);
            permissions[key] = match ? match.permission : null;
        } else {
            permissions[key] = null;
        }
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
};

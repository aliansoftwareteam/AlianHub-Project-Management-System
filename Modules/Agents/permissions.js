const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { myCache } = require('../../Config/config');
const { getRoleType, isPrivileged, arrangeRules, isWritable, isReadable } = require('../../Config/permissionGuard');
const { fetchRules } = require('../settings/securityPermissions/controller');
const registry = require('./registry');

// The person behind an agent decides what the agent may do: the token holder,
// the person who started the run, or the approver of a proposal. Their
// Security & Permissions catalogue is evaluated for the action's project the
// same way the web app evaluates it for them — global rules, or the project's
// own rules when the project opted out of the global ones. Anything that
// cannot be resolved (no person, not a member, rules unreadable) is refused.

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const PROJECT_RULES_TTL_SECONDS = 604800;
const REASON = 'permission_denied';

const oid = (v) => (OBJECT_ID.test(String(v || '')) ? new mongoose.Types.ObjectId(String(v)) : null);

const lookup = (arranged, path) => {
    let rule = null;
    for (const segment of String(path).split('.')) {
        rule = rule ? rule[segment] : arranged[segment];
        if (rule === undefined || rule === null) return null;
    }
    return rule && Array.isArray(rule.roles) ? rule : null;
};

/* Same cache key as Modules/projectRules, so an edit there invalidates this too. */
const projectRules = async (companyId, projectId) => {
    const key = `projectRules:${projectId}`;
    const cached = myCache.get(key);
    if (Array.isArray(cached) && cached.length) return cached;
    const rules = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECT_RULES, data: [{ projectId: String(projectId) }] }, 'find');
    myCache.set(key, rules || [], PROJECT_RULES_TTL_SECONDS);
    return rules || [];
};

const rulesFor = async (companyId, projectId) => {
    const project = projectId && oid(projectId)
        ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: oid(projectId) }, { isGlobalPermission: 1 }] }, 'findOne')
        : null;
    if (project && project.isGlobalPermission === false) return arrangeRules(await projectRules(companyId, projectId));
    return arrangeRules(await fetchRules(companyId));
};

const projectOf = async (companyId, params = {}) => {
    if (params.projectId) return String(params.projectId);
    const taskId = oid(params.taskId);
    if (!taskId) return null;
    const task = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: taskId }, { ProjectID: 1 }] }, 'findOne');
    return task && task.ProjectID ? String(task.ProjectID) : null;
};

/* null | false | true (or 1 | 2 for scoped keys), exactly as the catalogue stores it. */
const evaluate = async (companyId, uid, key, { projectId } = {}) => {
    const roleType = await getRoleType(companyId, uid);
    if (roleType === null) return null;
    if (isPrivileged(roleType)) return true;
    const rule = lookup(await rulesFor(companyId, projectId), key);
    if (!rule) return null;
    const match = rule.roles.find((r) => r.key === roleType);
    return match ? match.permission : null;
};

const denied = (key, why) => ({ allowed: false, reason: `${REASON}: ${key} ${why}`, permission: key });

/* Does the person behind `actor` hold every catalogue entry `action` needs? */
const holderMay = async (companyId, actor, action, params = {}) => {
    const required = registry.permissionsFor(action, params);
    if (!required.length) return { allowed: true, reason: '', permission: null };
    const uid = String((actor && actor.userId) || '');
    if (!OBJECT_ID.test(uid)) return denied(required[0].key, 'cannot be checked — no person is behind this agent');
    let projectId;
    try {
        projectId = await projectOf(companyId, params);
        for (const { key, write } of required) {
            const value = await evaluate(companyId, uid, key, { projectId });
            if (!(write ? isWritable(value) : isReadable(value))) return denied(key, 'is not granted to the person behind this agent');
        }
    } catch (e) {
        return denied(required[0].key, `could not be evaluated (${e.message})`);
    }
    return { allowed: true, reason: '', permission: null };
};

module.exports = { holderMay, evaluate, REASON };

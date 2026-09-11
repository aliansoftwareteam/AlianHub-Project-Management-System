const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { evaluatePermission, isWritable, isReadable } = require('../../Config/permissionGuard');
const registry = require('./registry');

// The person behind an agent decides what the agent may do: the token holder,
// the person who started the run, or the approver of a proposal. Their
// Security & Permissions catalogue is evaluated for the action's project by the
// same evaluator the API guards use. Anything that cannot be resolved (no
// person, not a member, rules unreadable) is refused.

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const REASON = 'permission_denied';

const oid = (v) => (OBJECT_ID.test(String(v || '')) ? new mongoose.Types.ObjectId(String(v)) : null);

const projectOf = async (companyId, params = {}) => {
    if (params.projectId) return String(params.projectId);
    const taskId = oid(params.taskId);
    if (!taskId) return null;
    const task = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: taskId }, { ProjectID: 1 }] }, 'findOne');
    return task && task.ProjectID ? String(task.ProjectID) : null;
};

const denied = (key, why) => ({ allowed: false, reason: `${REASON}: ${key} ${why}`, permission: key });

/* Does the person behind `actor` hold every catalogue entry `action` needs? */
const holderMay = async (companyId, actor, action, params = {}) => {
    const required = registry.permissionsFor(action, params);
    if (!required.length) return { allowed: true, reason: '', permission: null };
    const uid = String((actor && actor.userId) || '');
    if (!OBJECT_ID.test(uid)) return denied(required[0].key, 'cannot be checked — no person is behind this agent');
    try {
        const projectId = await projectOf(companyId, params);
        for (const { key, write } of required) {
            const value = await evaluatePermission(companyId, uid, key, { projectId });
            if (!(write ? isWritable(value) : isReadable(value))) return denied(key, 'is not granted to the person behind this agent');
        }
    } catch (e) {
        return denied(required[0].key, `could not be evaluated (${e.message})`);
    }
    return { allowed: true, reason: '', permission: null };
};

module.exports = { holderMay, evaluate: evaluatePermission, REASON };

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');
const { ROLE_GUEST } = require('../../../Config/roleTypes');
const { idForms } = require('../../../utils/mongo-handler/objectIdKeys');
const { visibilityStage, toObjectIds } = require('../../Tasks/helpers/taskQueryGuard');

// A scheduled run reads as the schedule's owner, exactly as a run that person
// started would: the task filter their own list applies, narrowed further by the
// agent's project scope. Owning a schedule is for owners, admins and the agent's
// own owner, checked when it is saved and again every time it fires.

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

const REFUSAL = Object.freeze({
    NOT_MEMBER: 'The schedule\'s owner is no longer a member of this workspace.',
    NOT_ALLOWED: 'A schedule can only run as an owner, an admin or the agent\'s owner.',
});

const ownerMayRun = async (companyId, agent, ownerId) => {
    if (!OBJECT_ID.test(String(ownerId || ''))) return { ok: false, reason: REFUSAL.NOT_MEMBER };
    const roleType = await getRoleType(companyId, ownerId);
    if (roleType === null || roleType === undefined || roleType === ROLE_GUEST) return { ok: false, reason: REFUSAL.NOT_MEMBER };
    if (isPrivileged(roleType) || String(agent && agent.ownerId) === String(ownerId)) return { ok: true, reason: '', privileged: isPrivileged(roleType) };
    return { ok: false, reason: REFUSAL.NOT_ALLOWED };
};

/* The owner's task filter; one that names no ProjectID reads every project in the company. */
const taskScopeFor = async (companyId, ownerId, agent) => {
    const stage = await visibilityStage(companyId, ownerId);
    const scope = stage ? { ...stage.$match } : {};
    const scoped = ((agent && agent.projectIds) || []).map(String);
    if (!scoped.length) return scope;
    const visible = scope.ProjectID ? scope.ProjectID.$in.map(String) : scoped;
    scope.ProjectID = { $in: toObjectIds(visible.filter((id) => scoped.includes(id))) };
    return scope;
};

const ownerSeesTask = async (companyId, scope, taskId) => {
    if (!OBJECT_ID.test(String(taskId || ''))) return null;
    return MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS, data: [{ $and: [scope, { _id: oid(taskId), deletedStatusKey: { $ne: 1 }, mainChat: { $ne: true } }] }, { ProjectID: 1, sprintId: 1, TaskName: 1 }],
    }, 'findOne').catch(() => null);
};

const ownerSeesProject = async (companyId, scope, projectId) => {
    if (!OBJECT_ID.test(String(projectId || ''))) return false;
    if (scope.ProjectID && !scope.ProjectID.$in.map(String).includes(String(projectId))) return false;
    const project = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS, data: [{ _id: oid(projectId), deletedStatusKey: { $ne: 1 } }, { _id: 1 }],
    }, 'findOne').catch(() => null);
    return Boolean(project);
};

/* What a shared destination's readers can all open: the owner's view cut to the destination's
 * project, without the project's private sprints. The destination task's own sprint stays in,
 * because whoever reads that task's thread is on it. */
const sharedScopeFor = async (companyId, ownerScope, projectId, { sprintId } = {}) => {
    const privateSprints = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SPRINTS, data: [{ projectId: { $in: idForms([String(projectId)]) }, private: true }, { _id: 1 }],
    }, 'find');
    const hidden = (privateSprints || []).map((s) => String(s._id)).filter((id) => id !== String(sprintId || ''));
    const clauses = [ownerScope, { ProjectID: { $in: idForms([String(projectId)]) } }];
    if (hidden.length) clauses.push({ sprintId: { $nin: idForms(hidden) } });
    return { $and: clauses.filter((c) => c && Object.keys(c).length) };
};

module.exports = { REFUSAL, ownerMayRun, taskScopeFor, ownerSeesTask, ownerSeesProject, sharedScopeFor };

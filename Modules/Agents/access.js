const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { resolveActor, isAgent } = require('./actor');
const scope = require('./scope');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { hiddenSprintIds, canSeeSprintById } = require('../Sprints/helpers/sprintVisibility');
const privateWork = require('./privateWork');
const { idForms } = require('../../utils/mongo-handler/objectIdKeys');

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const GATE_OWNER_ADMIN = 'owner_admin';

const sameId = (a, b) => Boolean(a) && Boolean(b) && String(a) === String(b);

const privileged = async (companyId, uid) => isPrivileged(await getRoleType(companyId, uid));

const humanActor = async (req) => {
    const actor = req.agentActor || await resolveActor(req);
    return { actor, human: !isAgent(actor) && Boolean(actor.userId) };
};

/* The caller's standing in a company: who they are and whether they hold the owner/admin role.
 * Agents never hold it, even when the person behind the token does. */
const callerOf = async (req, companyId) => {
    const { actor, human } = await humanActor(req);
    return { actor, human, privileged: human && Boolean(companyId) && await privileged(companyId, actor.userId) };
};

const canManageAgents = (caller) => Boolean(caller && caller.human && caller.privileged);

const ownerOrManager = (caller, personId) => Boolean(caller && caller.human && (caller.privileged || sameId(personId, caller.actor.userId)));

const canControlRun = (caller, run) => ownerOrManager(caller, run && run.startedBy);

const canUndoDecision = (caller, proposal) => ownerOrManager(caller, proposal && proposal.decidedBy);

const canActAsAgent = (caller, agentId) => Boolean(caller && isAgent(caller.actor) && sameId(caller.actor.agentId, agentId));

/* null means every project; otherwise the ids the caller may open. */
const visibleProjectIdsFor = async (companyId, caller) => (caller.privileged ? null : (await scope.visibleProjectIds(companyId, caller.actor.userId)).map(String));

/* projectScoped keeps an agent limited to projects the viewer cannot open from reading as unrestricted. */
const agentProjectsFor = (agent, visible) => {
    const all = ((agent && agent.projectIds) || []).map(String);
    return { projectIds: visible ? all.filter((id) => visible.includes(id)) : all, projectScoped: all.length > 0 };
};

/* null for owners and admins; otherwise the tasks in `projectIds` that sit in a private sprint the caller is not on. */
const hiddenTaskIdsFor = async (companyId, caller, projectIds) => {
    if (!projectIds) return null;
    const sprints = await hiddenSprintIds(companyId, caller.actor.userId, projectIds);
    if (!sprints.length) return [];
    const tasks = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ sprintId: { $in: sprints } }, '_id'] }, 'find');
    return (tasks || []).map((task) => String(task._id));
};

/* A run or proposal on a task the caller cannot read is treated as one that does not exist. */
const canSeeTaskOf = async (companyId, caller, record) => {
    if (caller.privileged || !record || !OBJECT_ID.test(String(record.taskId || ''))) return true;
    const task = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: String(record.taskId) }, 'sprintId'] }, 'findOne');
    return !task || canSeeSprintById(companyId, caller.actor.userId, task.sprintId);
};

const projectScope = (projectIds) => (projectIds ? { projectId: { $in: projectIds } } : {});

/* Owners and admins read every project, so what is someone else's alone is left out for them by rule;
 * everyone else's project list already leaves it out, and for them this is null. */
const privateWorkFor = async (companyId, caller) => (caller.privileged ? privateWork.privateWorkOf(companyId, caller.actor.userId) : null);

/* What a list, a count or a summary of agent records is read through. */
const readScopeOf = async (companyId, caller) => {
    const projectIds = await visibleProjectIdsFor(companyId, caller);
    const [hiddenTaskIds, privateScope] = await Promise.all([hiddenTaskIdsFor(companyId, caller, projectIds), privateWorkFor(companyId, caller)]);
    return { projectIds, hiddenTaskIds, privateWork: privateScope };
};

/* The clause every list of proposals is read through, whichever screen asks. */
const proposalScopeClause = ({ projectIds, hiddenTaskIds, privateWork: privateScope } = {}) => ({
    ...(Array.isArray(projectIds) ? { projectId: { $in: idForms(projectIds.map(String)) } } : {}),
    ...(Array.isArray(hiddenTaskIds) && hiddenTaskIds.length ? { taskId: { $nin: hiddenTaskIds.map(String) } } : {}),
    ...(privateScope ? privateWork.proposalClause(privateScope) : {}),
});

const mayDecideProposal = (caller, proposal) => Boolean(caller && caller.human) && (proposal.gate !== GATE_OWNER_ADMIN || Boolean(caller.privileged));

const inOpenProject = async (companyId, caller, record) => {
    const visible = await visibleProjectIdsFor(companyId, caller);
    return visible.includes(String(record.projectId || '')) && canSeeTaskOf(companyId, caller, record);
};

const canSeeRun = async (companyId, caller, run) => (caller.privileged
    ? privateWork.readsRun(await privateWork.privateWorkOf(companyId, caller.actor.userId), run)
    : inOpenProject(companyId, caller, run));

/* For the routes that take runs from a store of their own. */
const readableRuns = async (companyId, caller, runs) => {
    if (!caller.privileged) return runs;
    const scope = await privateWork.privateWorkOf(companyId, caller.actor.userId);
    return runs.filter((run) => privateWork.readsRun(scope, run));
};

const startedBy = async (companyId, runId) => {
    if (!runId) return '';
    const run = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_RUNS, data: [{ _id: String(runId) }, 'startedBy'] }, 'findOne').catch(() => null);
    return String((run && run.startedBy) || '');
};

/* A proposal is seen by whoever may open its project, and by the person the agent worked for. */
const canSeeProposal = async (companyId, caller, proposal) => {
    const uid = String(caller.actor.userId || '');
    if (caller.privileged) return privateWork.readsProposal(await privateWork.privateWorkOf(companyId, uid), proposal);
    if (await inOpenProject(companyId, caller, proposal)) return true;
    return Boolean(uid) && [String(proposal.requestedBy || ''), await startedBy(companyId, proposal.runId)].includes(uid);
};

const REFUSAL = Object.freeze({
    MANAGE: 'Only an Owner or an Admin can manage agents.',
    CONTROL_RUN: 'Only an Owner, an Admin or the person who started the run can stop it.',
    UNDO_DECISION: 'Only an Owner, an Admin or the person who decided the proposal can undo it.',
    ACT_AS_AGENT: 'Only the agent itself can file a proposal in its name.',
});

module.exports = {
    privileged, humanActor, callerOf, canManageAgents, canControlRun, canUndoDecision, canActAsAgent,
    visibleProjectIdsFor, agentProjectsFor, hiddenTaskIdsFor, canSeeTaskOf, projectScope, REFUSAL,
    privateWorkFor, readScopeOf, canSeeRun, readableRuns, canSeeProposal,
    GATE_OWNER_ADMIN, proposalScopeClause, mayDecideProposal,
};

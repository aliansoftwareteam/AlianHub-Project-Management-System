const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { ROLE_GUEST } = require('../../Config/roleTypes');
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

const NO_SEAT = Object.freeze({ privileged: false, member: false });

/* A person's seat in a company: the owner/admin role, and a member's seat, which a guest's is not. */
const seatOf = async (companyId, uid) => {
    const role = companyId && uid ? await getRoleType(companyId, uid) : null;
    if (role === null || role === undefined) return NO_SEAT;
    return { privileged: isPrivileged(role), member: role !== ROLE_GUEST };
};

/* The caller's standing in a company: who they are and the seat they hold.
 * Agents never hold one, even when the person behind the token does. */
const callerOf = async (req, companyId) => {
    const { actor, human } = await humanActor(req);
    return { actor, human, ...(human ? await seatOf(companyId, actor.userId) : NO_SEAT) };
};

/* The same standing for a person named by id, for a screen read on their behalf. */
const personOf = async (companyId, userId) => ({ actor: { kind: 'human', userId: String(userId) }, human: true, ...(await seatOf(companyId, userId)) });

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

const namedTaskIds = (record) => [record.taskId, ...(Array.isArray(record.taskIds) ? record.taskIds : [])].map((id) => String(id || '')).filter((id) => OBJECT_ID.test(id));

/* A run or proposal on a task the caller cannot read is treated as one that does not exist. A batch names several tasks. */
const canSeeTaskOf = async (companyId, caller, record) => {
    if (caller.privileged || !record) return true;
    for (const taskId of new Set(namedTaskIds(record))) {
        // eslint-disable-next-line no-await-in-loop
        const task = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: taskId }, 'sprintId'] }, 'findOne');
        // eslint-disable-next-line no-await-in-loop
        if (task && !(await canSeeSprintById(companyId, caller.actor.userId, task.sprintId))) return false;
    }
    return true;
};

const projectScope = (projectIds) => (projectIds ? { projectId: { $in: projectIds } } : {});

/* Owners and admins read every project, so what is someone else's alone is left out for them by rule;
 * everyone else's project list already leaves it out, and for them this is null. */
const privateWorkFor = async (companyId, caller) => (caller.privileged ? privateWork.privateWorkOf(companyId, caller.actor.userId) : null);

/* What a list, a count or a summary of agent records is read through. */
const readScopeOf = async (companyId, caller) => {
    const projectIds = await visibleProjectIdsFor(companyId, caller);
    const [hiddenTaskIds, privateScope] = await Promise.all([hiddenTaskIdsFor(companyId, caller, projectIds), privateWorkFor(companyId, caller)]);
    return { projectIds, hiddenTaskIds, privateWork: privateScope, askedBy: String(caller.actor.userId || '') };
};

/* A change that names no project yet, a new project for one, is listed for the person whose agent asked for it, as canSeeProposal answers for one. */
const inProjectsOrOwn = (projectIds, askedBy) => {
    const inProjects = { projectId: { $in: idForms(projectIds.map(String)) } };
    return OBJECT_ID.test(String(askedBy || '')) ? { $or: [inProjects, { projectId: null, requestedBy: String(askedBy) }] } : inProjects;
};

/* The clause every list of proposals is read through, whichever screen asks. */
const proposalScopeClause = ({ projectIds, hiddenTaskIds, privateWork: privateScope, askedBy } = {}) => ({
    ...(Array.isArray(projectIds) ? inProjectsOrOwn(projectIds, askedBy) : {}),
    ...(Array.isArray(hiddenTaskIds) && hiddenTaskIds.length ? { taskId: { $nin: hiddenTaskIds.map(String) }, taskIds: { $nin: hiddenTaskIds.map(String) } } : {}),
    ...(privateScope ? privateWork.proposalClause(privateScope) : {}),
});

/* Approving, declining or undoing: a person holding a member's seat. A guest's seat decides none.
 * Whether one proposal is theirs to approve or decline is ./approverRights. */
const decidesProposals = (caller) => Boolean(caller && caller.human && caller.member);

const PROJECT_PARAMS = Object.freeze(['projectId', 'listProjectId']);

const namedProjects = (proposal) => (Array.isArray(proposal.changes) ? proposal.changes : [])
    .flatMap((change) => PROJECT_PARAMS.map((key) => change && change.params && change.params[key]))
    .filter(Boolean)
    .map(String);

/* A change that reaches into a project is read only by who may open that project too. projectIds is null for an owner or admin. */
const staysInside = (projectIds) => (proposal) => !Array.isArray(projectIds)
    || namedProjects(proposal).every((id) => projectIds.includes(id));

/* The rows staysInside leaves out, as a clause: a count takes them off without reading every row. */
const reachesOutsideClause = (projectIds) => {
    const open = [...idForms(projectIds.map(String)), null, ''];
    return { changes: { $elemMatch: { $or: PROJECT_PARAMS.map((key) => ({ [`params.${key}`]: { $exists: true, $nin: open } })) } } };
};

const inOpenProject = async (companyId, caller, record) => {
    const visible = await visibleProjectIdsFor(companyId, caller);
    return visible.includes(String(record.projectId || '')) && staysInside(visible)(record) && canSeeTaskOf(companyId, caller, record);
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

/* The person an agent asked for: whose connection filed it, or who started the run that did. */
const askedFor = async (companyId, uid, proposal) => Boolean(uid)
    && [String(proposal.requestedBy || ''), await startedBy(companyId, proposal.runId)].includes(String(uid));

const inOwnPersonalList = async (companyId, uid, proposal) => {
    if (!uid || !OBJECT_ID.test(String(proposal.projectId || ''))) return false;
    const list = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS, data: [{ _id: String(proposal.projectId), isPersonal: true, personalOwner: String(uid) }, '_id'],
    }, 'findOne').catch(() => null);
    return Boolean(list);
};

/* A proposal is the person's own to take back when their agent asked for it, or it sits in their personal list. */
const isOwnProposal = async (companyId, uid, proposal) => (await askedFor(companyId, uid, proposal)) || inOwnPersonalList(companyId, uid, proposal);

/* A proposal is seen by whoever may open its project, and by the person the agent worked for. */
const canSeeProposal = async (companyId, caller, proposal) => {
    const uid = String(caller.actor.userId || '');
    if (caller.privileged) return privateWork.readsProposal(await privateWork.privateWorkOf(companyId, uid), proposal);
    if (await inOpenProject(companyId, caller, proposal)) return true;
    return askedFor(companyId, uid, proposal);
};

const REFUSAL = Object.freeze({
    MANAGE: 'Only an Owner or an Admin can manage agents.',
    CONTROL_RUN: 'Only an Owner, an Admin or the person who started the run can stop it.',
    UNDO_DECISION: 'Only an Owner, an Admin or the person who decided the proposal can undo it.',
    ACT_AS_AGENT: 'Only the agent itself can file a proposal in its name.',
    DECIDE_PERSON: 'Agents cannot decide proposals — a person has to.',
    DECIDE_MEMBER: 'A proposal is decided by a member of the workspace.',
});

module.exports = {
    privileged, humanActor, callerOf, personOf, canManageAgents, canControlRun, canUndoDecision, canActAsAgent,
    visibleProjectIdsFor, agentProjectsFor, hiddenTaskIdsFor, canSeeTaskOf, projectScope, REFUSAL,
    privateWorkFor, readScopeOf, canSeeRun, readableRuns, canSeeProposal,
    GATE_OWNER_ADMIN, proposalScopeClause, decidesProposals, staysInside, reachesOutsideClause, isOwnProposal,
};

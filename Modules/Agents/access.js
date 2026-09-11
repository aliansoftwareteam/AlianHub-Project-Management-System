const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { resolveActor, isAgent } = require('./actor');
const scope = require('./scope');

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

const projectScope = (projectIds) => (projectIds ? { projectId: { $in: projectIds } } : {});

const REFUSAL = Object.freeze({
    MANAGE: 'Only an Owner or an Admin can manage agents.',
    CONTROL_RUN: 'Only an Owner, an Admin or the person who started the run can stop it.',
    UNDO_DECISION: 'Only an Owner, an Admin or the person who decided the proposal can undo it.',
    ACT_AS_AGENT: 'Only the agent itself can file a proposal in its name.',
});

module.exports = {
    privileged, humanActor, callerOf, canManageAgents, canControlRun, canUndoDecision, canActAsAgent,
    visibleProjectIdsFor, projectScope, REFUSAL,
};

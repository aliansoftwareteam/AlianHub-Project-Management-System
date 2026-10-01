const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');
const { ROLE_GUEST } = require('../../../Config/roleTypes');
const access = require('../../Agents/access');
const permissions = require('../../Agents/permissions');

// The queue is a view of the proposals the agent API already lists for this person
// (access.readScopeOf), never a wider one. Deciding still goes through that API, so a row
// shown here that the person may not decide is refused there.

const QUEUE_LIMIT = 100;
const SOURCE_MCP = 'mcp';
const SOURCE_SYSTEM = 'system';
const PROJECT_PARAMS = Object.freeze(['projectId', 'listProjectId']);

const plain = (row) => (row && typeof row.toObject === 'function' ? row.toObject() : row);

const namedProjects = (proposal) => (Array.isArray(proposal.changes) ? proposal.changes : [])
    .flatMap((change) => PROJECT_PARAMS.map((key) => change && change.params && change.params[key]))
    .filter(Boolean)
    .map(String);

/* projectIds is null for an owner or admin, who opens every project. */
const staysInside = (projectIds) => (proposal) => !Array.isArray(projectIds)
    || namedProjects(proposal).every((id) => projectIds.includes(id));

const toRow = (caller) => (proposal) => ({
    sourceType: 'proposal',
    sourceId: String(proposal._id),
    proposalId: String(proposal._id),
    kind: 'proposal',
    agentName: proposal.agentName || 'Agent',
    agentId: proposal.agentId ? String(proposal.agentId) : '',
    source: proposal.source || '',
    ...(proposal.finding ? { finding: proposal.finding } : {}),
    requestedBy: proposal.requestedBy ? String(proposal.requestedBy) : '',
    what: proposal.what || '',
    why: proposal.why || '',
    changes: (Array.isArray(proposal.changes) ? proposal.changes : []).map((change) => ({
        action: change.action, params: change.params || {}, label: change.label || change.action, reversible: Boolean(change.reversible),
    })),
    cost: proposal.cost || null,
    gate: proposal.gate || null,
    locked: !access.mayDecideProposal(caller, proposal),
    // approval.refusalFor refuses an edited approval of a change a connected agent filed.
    editable: proposal.source !== SOURCE_MCP,
    tainted: Boolean(proposal.taint && proposal.taint.reason),
    taskId: proposal.taskId ? String(proposal.taskId) : '',
    projectId: proposal.projectId ? String(proposal.projectId) : '',
    createdAt: proposal.createdAt,
    unread: true,
});

/* A change the system filed runs on the approver's own rights, so it is offered only to a person who could make it by hand. */
const heldToOwnRights = (companyId, userId) => async (row) => {
    if (row.source !== SOURCE_SYSTEM || row.locked) return row;
    const answers = await Promise.all(row.changes.map((change) => permissions.holderMay(companyId, { userId: String(userId) }, change.action, change.params)));
    return answers.every((answer) => answer.allowed) ? row : { ...row, locked: true };
};

const readQueue = async (companyId, userId) => {
    const roleType = await getRoleType(companyId, userId);
    if (roleType === null || roleType === undefined || roleType === ROLE_GUEST) return [];
    const caller = { actor: { kind: 'human', userId: String(userId) }, human: true, privileged: isPrivileged(roleType) };
    const scope = await access.readScopeOf(companyId, caller);
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENT_PROPOSALS,
        data: [{ status: 'pending', ...access.proposalScopeClause(scope) }, {}, { sort: { createdAt: -1 }, limit: QUEUE_LIMIT }],
    }, 'find');
    return Promise.all((rows || []).map(plain).filter(staysInside(scope.projectIds)).map(toRow(caller)).map(heldToOwnRights(companyId, userId)));
};

const waitingCount = (rows) => rows.filter((row) => !row.locked).length;

module.exports = { readQueue, waitingCount, QUEUE_LIMIT };

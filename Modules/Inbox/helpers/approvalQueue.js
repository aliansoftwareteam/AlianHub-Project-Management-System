const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const access = require('../../Agents/access');
const permissions = require('../../Agents/permissions');
const intentPreview = require('../../Agents/intentPreview');
const standingApprovals = require('../../Agents/standingApprovals');
const logger = require('../../../Config/loggerConfig');

// The queue is a view of the proposals the agent API already lists for this person
// (access.readScopeOf), never a wider one. Deciding still goes through that API, so a row
// shown here that the person may not decide is refused there.

const QUEUE_LIMIT = 100;
const APPLIED_LIMIT = 20;
const SOURCE_MCP = 'mcp';
const SOURCE_SYSTEM = 'system';

const plain = (row) => (row && typeof row.toObject === 'function' ? row.toObject() : row);

/* Whether "Always do this" is offered on the row, and the kind of change it would cover. */
const alwaysOf = (caller, proposal) => {
    const offered = access.mayDecideProposal(caller, proposal) && standingApprovals.offerable(proposal);
    return offered ? { always: true, alwaysKind: standingApprovals.labelOf(proposal.changes[0].action) } : { always: false };
};

const toRow = (caller, previews, batches = new Map()) => (proposal) => ({
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
    changes: (Array.isArray(proposal.changes) ? proposal.changes : []).map((change, at) => {
        const preview = (previews.get(String(proposal._id)) || [])[at];
        return { action: change.action, params: change.params || {}, label: change.label || change.action, reversible: Boolean(change.reversible), ...(preview ? { preview } : {}) };
    }),
    ...(batches.has(String(proposal._id)) ? { batch: batches.get(String(proposal._id)) } : {}),
    cost: proposal.cost || null,
    gate: proposal.gate || null,
    locked: !access.mayDecideProposal(caller, proposal),
    ...alwaysOf(caller, proposal),
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
    const caller = await access.personOf(companyId, userId);
    if (!caller.member) return [];
    const scope = await access.readScopeOf(companyId, caller);
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENT_PROPOSALS,
        data: [{ status: 'pending', ...access.proposalScopeClause(scope) }, {}, { sort: { createdAt: -1 }, limit: QUEUE_LIMIT }],
    }, 'find');
    const listed = (rows || []).map(plain).filter(access.staysInside(scope.projectIds));
    // The queue is still worth showing without its cards.
    const cards = (build) => build(companyId, userId, listed).catch((error) => {
        logger.error(`[inbox] proposal previews: ${error.message}`);
        return new Map();
    });
    const [previews, batches] = await Promise.all([cards(intentPreview.forProposals), cards(intentPreview.forBatches)]);
    return Promise.all(listed.map(toRow(caller, previews, batches)).map(heldToOwnRights(companyId, userId)));
};

const waitingCount = (rows) => rows.filter((row) => !row.locked).length;

/* What the person's own standing approvals applied, while each can still be undone from here. */
const readApplied = async (companyId, userId) => {
    const caller = await access.personOf(companyId, userId);
    if (!caller.member) return [];
    const scope = await access.readScopeOf(companyId, caller);
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENT_PROPOSALS,
        data: [{ status: 'approved', decidedBy: String(userId), standingApprovalId: { $exists: true }, undoUntil: { $gt: new Date() }, ...access.proposalScopeClause(scope) }, {}, { sort: { createdAt: -1 }, limit: APPLIED_LIMIT }],
    }, 'find');
    const listed = (rows || []).map(plain).filter(access.staysInside(scope.projectIds));
    const previews = await intentPreview.forProposals(companyId, userId, listed).catch(() => new Map());
    return listed.map(toRow(caller, previews)).map((row, at) => ({ ...row, always: false, unread: false, undoUntil: listed[at].undoUntil }));
};

module.exports = { readQueue, readApplied, waitingCount, QUEUE_LIMIT };

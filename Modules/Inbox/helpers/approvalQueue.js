const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const access = require('../../Agents/access');
const approverRights = require('../../Agents/approverRights');
const intentPreview = require('../../Agents/intentPreview');
const changeLabels = require('../../Agents/changeLabels');
const proposalText = require('../../Agents/proposalText');
const standingApprovals = require('../../Agents/standingApprovals');
const logger = require('../../../Config/loggerConfig');

// The queue is a view of the proposals the agent API already lists for this person
// (access.readScopeOf), never a wider one. Deciding still goes through that API, which reads
// the same rule (Agents/approverRights) a row's `locked` is read from.

const QUEUE_LIMIT = 100;
const APPLIED_LIMIT = 20;
const SOURCE_MCP = 'mcp';

const plain = (row) => (row && typeof row.toObject === 'function' ? row.toObject() : row);

/* Whether "Always do this" is offered on the row, and the kind of change it would cover. */
const alwaysOf = (standing, proposal) => {
    const offered = !standing.locked && standingApprovals.offerable(proposal);
    return offered ? { always: true, alwaysKind: standingApprovals.labelOf(proposal.changes[0].action) } : { always: false };
};

/* A change is shown through its card, which is built for the viewer. The change as filed goes only with a proposal
 * a person can edit, to a person who may decide it: approving an edit sends the kept changes back. */
const toRow = (previews, batches = new Map()) => (proposal, standing) => ({
    sourceType: 'proposal',
    sourceId: String(proposal._id),
    proposalId: String(proposal._id),
    kind: 'proposal',
    agentName: proposalText.nameOf(proposal.agentName) || 'Agent',
    agentId: proposal.agentId ? String(proposal.agentId) : '',
    source: proposal.source || '',
    ...(proposal.finding ? { finding: proposal.finding } : {}),
    requestedBy: proposal.requestedBy ? String(proposal.requestedBy) : '',
    what: proposalText.titleOf(proposal.what, proposal.changes),
    why: proposalText.reasonOf(proposal.why),
    changes: (Array.isArray(proposal.changes) ? proposal.changes : []).map((change, at) => {
        const preview = (previews.get(String(proposal._id)) || [])[at];
        const asFiled = proposal.source !== SOURCE_MCP && !standing.locked ? { params: change.params || {} } : {};
        return { action: change.action, ...asFiled, label: change.label || change.action, reversible: Boolean(change.reversible), ...(preview ? { preview } : {}), ...changeLabels.markOf(change) };
    }),
    ...(batches.has(String(proposal._id)) ? { batch: batches.get(String(proposal._id)) } : {}),
    cost: proposal.cost || null,
    gate: proposal.gate || null,
    locked: standing.locked,
    lockedWhy: standing.lockedWhy,
    mayDecline: standing.mayDecline,
    ...alwaysOf(standing, proposal),
    // approval.refusalFor refuses an edited approval of a change a connected agent filed.
    editable: proposal.source !== SOURCE_MCP,
    tainted: Boolean(proposal.taint && proposal.taint.reason),
    taskId: proposal.taskId ? String(proposal.taskId) : '',
    projectId: proposal.projectId ? String(proposal.projectId) : '',
    createdAt: proposal.createdAt,
    unread: true,
});

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
    const cards = (build) => build(companyId, userId, listed, { bareChanges: true }).catch((error) => {
        logger.error(`[inbox] proposal previews: ${error.message}`);
        return new Map();
    });
    const [previews, batches, standings] = await Promise.all([cards(intentPreview.forProposals), cards(intentPreview.forBatches), approverRights.standingsOf(companyId, caller, listed)]);
    const row = toRow(previews, batches);
    return listed.map((proposal, at) => row(proposal, standings[at]));
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
    return listed.map((proposal) => ({ ...toRow(previews)(proposal, approverRights.OPEN), always: false, unread: false, undoUntil: proposal.undoUntil }));
};

module.exports = { readQueue, readApplied, waitingCount, QUEUE_LIMIT };

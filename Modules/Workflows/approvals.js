const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const store = require('./store');

// The human decision a workflow waits on, as a row of its own.
//
// It is not kept on the step run because the two are read by different people at
// different times: the step run is the engine's bookkeeping, and this is the
// request a person opens, owns, hands on and answers. The unique index on
// { runId, stepId } is what makes a re-ticked approval step open the same
// request rather than ask twice.
//
// Deciding is a compare-and-set on `status: pending`, so two people answering at
// once produce one decision and one "already decided", and the decision then
// wakes the step that was waiting for it.

const APPROVALS = SCHEMA_TYPE.WORKFLOW_APPROVALS;

const STATUS = Object.freeze({ PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected', EXPIRED: 'expired' });
const ON_DEADLINE = Object.freeze(['escalate', 'approve', 'reject', 'fail']);
const DECISIONS = Object.freeze([STATUS.APPROVED, STATUS.REJECTED]);

const call = (companyId, data, method) => MongoDbCrudOpration(companyId, { type: APPROVALS, data }, method);

const find = (companyId, runId, stepId) => call(companyId, [{ runId: String(runId), stepId: String(stepId) }], 'findOne');

/* Open the request, or hand back the one that is already open: a step claimed a
 * second time must not ask a second person the same question. */
const open = async (companyId, request) => {
    const { runId, stepId } = request;
    try {
        return await call(companyId, {
            runId: String(runId),
            stepId: String(stepId),
            workflowId: request.workflowId ? String(request.workflowId) : null,
            title: request.title || '',
            prompt: request.prompt || '',
            ownerUserId: request.ownerUserId ? String(request.ownerUserId) : null,
            ownerRole: request.ownerRole || null,
            escalateToUserId: request.escalateToUserId ? String(request.escalateToUserId) : null,
            escalateAt: request.escalateAt || null,
            deadlineAt: request.deadlineAt || null,
            onDeadline: ON_DEADLINE.includes(request.onDeadline) ? request.onDeadline : 'fail',
            owners: request.ownerUserId ? [String(request.ownerUserId)] : [],
            status: STATUS.PENDING,
            context: request.context || {},
        }, 'save');
    } catch (error) {
        if (!store.isDuplicateKey(error)) throw error;
        return find(companyId, runId, stepId);
    }
};

const get = find;

const listForOwner = (companyId, ownerUserId, status = STATUS.PENDING) => call(companyId, [
    { ownerUserId: String(ownerUserId), status }, null, { sort: { deadlineAt: 1, createdAt: 1 } },
], 'find');

const listDue = (companyId, now = new Date()) => call(companyId, [
    { status: STATUS.PENDING, $or: [{ deadlineAt: { $lte: now } }, { escalateAt: { $lte: now }, escalatedAt: null }] },
], 'find');

/* One decision per request, and the step that was waiting hears about it
 * immediately rather than on its next poll. Null means somebody else got there
 * first, which is a refusal to record a second answer, not an error. */
const decide = async (companyId, { runId, stepId, decision, decidedBy, comment = '' }) => {
    if (!DECISIONS.includes(decision)) throw Object.assign(new Error(`"${decision}" is not a decision`), { deterministic: true });
    const decided = await call(companyId, [
        { runId: String(runId), stepId: String(stepId), status: STATUS.PENDING },
        { $set: { status: decision, decidedBy: decidedBy ? String(decidedBy) : 'system', decidedAt: new Date(), comment: String(comment || '').slice(0, 1000) } },
        { returnDocument: 'after' },
    ], 'findOneAndUpdate');
    if (!decided) return null;
    await store.wakeStep(companyId, runId, stepId);
    return decided;
};

/* The escalation path: the deadline's first answer is a second person, not a
 * failure. The original owner stays on `owners`, so who was asked and in what
 * order survives the handover. */
const escalate = async (companyId, { runId, stepId, toUserId, at = new Date() }) => {
    const escalated = await call(companyId, [
        { runId: String(runId), stepId: String(stepId), status: STATUS.PENDING, escalatedAt: null },
        { $set: { escalatedAt: at, ...(toUserId ? { ownerUserId: String(toUserId) } : {}) }, ...(toUserId ? { $push: { owners: String(toUserId) } } : {}) },
        { returnDocument: 'after' },
    ], 'findOneAndUpdate');
    return escalated || null;
};

const reassign = async (companyId, { runId, stepId, toUserId }) => {
    const moved = await call(companyId, [
        { runId: String(runId), stepId: String(stepId), status: STATUS.PENDING },
        { $set: { ownerUserId: String(toUserId) }, $push: { owners: String(toUserId) } },
        { returnDocument: 'after' },
    ], 'findOneAndUpdate');
    return moved || null;
};

const expire = async (companyId, { runId, stepId, at = new Date() }) => {
    const expired = await call(companyId, [
        { runId: String(runId), stepId: String(stepId), status: STATUS.PENDING },
        { $set: { status: STATUS.EXPIRED, decidedAt: at, decidedBy: 'system' } },
        { returnDocument: 'after' },
    ], 'findOneAndUpdate');
    return expired || null;
};

module.exports = { STATUS, ON_DEADLINE, DECISIONS, open, get, listForOwner, listDue, decide, escalate, reassign, expire };

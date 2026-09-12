const executors = require('../executors');
const approvals = require('../approvals');
const store = require('../store');
const flag = require('../flag');
const { waitUntil } = require('./waiting');
const { num, deterministic, descendantsOf, skipAll } = require('./graph');

// A person is a step.
//
// Config: { title, prompt, ownerUserId, ownerRole, escalateToUserId,
//           escalateAfterMs, deadlineMs, onDeadline, onReject, pollMs }
// Output: { approvalId, decision, decidedBy, decidedAt, escalated }
//
// The step opens one approval request and then waits on it. Waiting is the whole
// design: the worker is handed back, the step row says what it is blocked on and
// who owns it, and the next claim reads the request rather than a person's answer
// being carried in memory by whichever process happened to ask.
//
// Deciding wakes the step, so a decision is acted on in the next tick rather than
// at the next poll. The poll is the floor underneath that — what notices a
// deadline when nobody decided anything at all.

const TYPE = 'human_approval';

const at = (from, ms) => new Date(from.getTime() + ms);

/* A refusal is an answer, not a fault: the run stops going down this path and
 * says why, instead of failing as though something broke. */
const refuse = async (companyId, run, step, request) => {
    const steps = await store.listSteps(companyId, run._id);
    const pruned = (step.config || {}).onReject === 'continue'
        ? []
        : await skipAll(companyId, run._id, descendantsOf(steps, step.stepId), `skipped: ${step.stepId} was not approved`);
    return {
        approvalId: String(request._id),
        decision: approvals.STATUS.REJECTED,
        decidedBy: request.decidedBy || null,
        decidedAt: request.decidedAt || null,
        comment: request.comment || '',
        skipped: pruned,
    };
};

const granted = (request, escalated) => ({
    approvalId: String(request._id),
    decision: approvals.STATUS.APPROVED,
    decidedBy: request.decidedBy || null,
    decidedAt: request.decidedAt || null,
    comment: request.comment || '',
    escalated,
});

const execute = async ({ companyId, run, step }) => {
    const config = step.config || {};
    const now = new Date();

    const opened = (await approvals.get(companyId, run._id, step.stepId)) || await approvals.open(companyId, {
        runId: run._id,
        stepId: step.stepId,
        workflowId: run.workflowId,
        title: config.title || run.name || '',
        prompt: config.prompt || '',
        ownerUserId: config.ownerUserId || null,
        ownerRole: config.ownerRole || null,
        escalateToUserId: config.escalateToUserId || null,
        escalateAt: config.escalateAfterMs ? at(now, num(config.escalateAfterMs, 0)) : null,
        deadlineAt: at(now, num(config.deadlineMs, flag.approvalDeadlineMs())),
        onDeadline: config.onDeadline,
        context: { taskId: config.taskId || null, projectId: config.projectId || null },
    });

    let request = opened;
    if (request.status === approvals.STATUS.APPROVED) return granted(request, Boolean(request.escalatedAt));
    if (request.status === approvals.STATUS.REJECTED) return refuse(companyId, run, step, request);
    if (request.status === approvals.STATUS.EXPIRED) {
        throw deterministic(`the approval on step ${step.stepId} expired without a decision`);
    }

    const deadlineAt = request.deadlineAt ? new Date(request.deadlineAt) : null;
    const escalateAt = request.escalateAt ? new Date(request.escalateAt) : null;

    if (escalateAt && !request.escalatedAt && escalateAt <= now) {
        request = (await approvals.escalate(companyId, { runId: run._id, stepId: step.stepId, toUserId: request.escalateToUserId, at: now })) || request;
    }

    if (deadlineAt && deadlineAt <= now) {
        const onDeadline = request.onDeadline || 'fail';
        if (onDeadline === 'approve' || onDeadline === 'reject') {
            const decision = onDeadline === 'approve' ? approvals.STATUS.APPROVED : approvals.STATUS.REJECTED;
            const decided = (await approvals.decide(companyId, { runId: run._id, stepId: step.stepId, decision, decidedBy: 'system', comment: 'decided by the deadline' }))
                || await approvals.get(companyId, run._id, step.stepId);
            return decided.status === approvals.STATUS.APPROVED
                ? granted(decided, Boolean(decided.escalatedAt))
                : refuse(companyId, run, step, decided);
        }
        await approvals.expire(companyId, { runId: run._id, stepId: step.stepId, at: now });
        throw deterministic(`the approval on step ${step.stepId} was not decided by ${deadlineAt.toISOString()}`);
    }

    // Look again when the next thing that can change the answer by itself is due:
    // the escalation if one is still ahead, otherwise the deadline.
    const next = escalateAt && !request.escalatedAt && escalateAt > now ? escalateAt : deadlineAt;
    const owner = request.ownerUserId ? `user ${request.ownerUserId}` : (request.ownerRole || 'an owner');
    return waitUntil(
        `waiting for ${owner} to approve${request.escalatedAt ? ' (escalated)' : ''}`,
        next || at(now, flag.approvalPollMs()),
        { pollMs: flag.approvalPollMs(), set: { approvalId: String(request._id), ...(step.waitingSince ? {} : { waitingSince: now }) } },
    );
};

executors.register(TYPE, execute);

module.exports = { TYPE, execute };

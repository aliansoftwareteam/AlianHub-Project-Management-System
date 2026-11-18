const approvals = require('./approvals');
const people = require('./people');
const approval = require('./stepTypes/approval');
const roleHandoff = require('./stepTypes/roleHandoff');

// A waiting step's reason is the engine's own line and names people and roles by id and key. A step waiting on a
// person or a role also gets `waitingFor`, who that is by name, so the run page can say it in words.

const isWaiting = (step) => Boolean(step && step.status === 'pending' && step.waitReason);

/* Read from the approval row rather than the reason, which still names whoever owned it before a reassignment. */
const approvalWait = (request, names) => ({
    kind: 'approval',
    name: names[String(request.ownerUserId)] || null,
    role: request.ownerUserId ? null : (request.ownerRole || null),
    escalated: Boolean(request.escalatedAt),
});

const withWaitingFor = async (companyId, runId, steps = []) => {
    const asked = steps.filter((step) => isWaiting(step) && step.type === approval.TYPE && step.approvalId);
    const found = await Promise.all(asked.map((step) => approvals.get(companyId, runId, step.stepId)));
    const requests = new Map(asked.map((step, index) => [String(step.stepId), found[index]]).filter(([, request]) => request));
    const names = requests.size ? ((await people.namesOf([...requests.values()].map((request) => request.ownerUserId))) || {}) : {};
    return steps.map((step) => {
        if (!isWaiting(step)) return step;
        const request = requests.get(String(step.stepId));
        const waitingFor = request ? approvalWait(request, names) : (step.type === roleHandoff.TYPE && roleHandoff.waitOf(step));
        return waitingFor ? { ...step, waitingFor } : step;
    });
};

module.exports = { withWaitingFor };

const projectPolicy = require('./projectPolicy');
const projectLimits = require('./projectLimits');
const audit = require('./agentAudit');
const { runningIn } = require('./manager/places');

// A workspace agent's run that an agent starts for its person: on the run route, or by naming the agent in a comment
// it posts on a comment route. A person's own start is not asked here.

const START = 'agent.run.start';
/* Over MCP an agent starts one by naming it in a task.comment, so the project answers for the start as it does for that comment. */
const ASKED_AS = 'task.comment';

const fullReason = (atOnce) => `this project already has ${atOnce} ${atOnce === 1 ? 'agent' : 'agents'} at work, which is as many as it takes at once`;

/* Why the project holds the start, or '' when it takes it. The count of tasks is asked last: an answer of yes there is kept. */
const heldBy = async (companyId, actor, task) => {
    const projectId = String(task.ProjectID || '');
    const [{ atOnce }, running] = await Promise.all([projectLimits.read(companyId, projectId), runningIn(companyId, projectId)]);
    if (running >= atOnce) return fullReason(atOnce);
    const rule = await projectPolicy.ask({ companyId, actor, action: ASKED_AS, params: { taskId: String(task._id) }, applying: true });
    return rule.decision === projectPolicy.DECISION.ACT ? '' : rule.reason;
};

/* For a caller with no answer of its own to give: a start that is held is recorded, and false comes back. */
const admits = async (companyId, actor, task, { path = '', ip = '' } = {}) => {
    const reason = await heldBy(companyId, actor, task);
    if (!reason) return true;
    const taskId = String(task._id);
    await audit.recordRefusal(companyId, actor, { action: START, reason, params: { taskId }, entityId: taskId, path, ip });
    return false;
};

module.exports = { START, heldBy, admits };

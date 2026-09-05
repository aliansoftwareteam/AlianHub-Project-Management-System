const registry = require('./registry');

// The rule-based review an L2 run puts every change through. No model is
// consulted: the same agent, action, params and rating always give the same
// decision, and the reason is written so a person reading the run can check it.
// The never-list and allowedActions are absolute at every autonomy level.

const DECISION = Object.freeze({ ACT: 'act', PROPOSE: 'propose', REFUSE: 'refuse' });
const SCOPES = Object.freeze(['task', 'project', 'workspace']);
const REVIEW_LEVEL = 2;

const isNever = (key) => registry.NEVER.some((n) => n === key || (n.endsWith('.*') && key.startsWith(n.slice(0, -1))));

const isComplete = (r) => Boolean(r) && typeof r.write === 'boolean' && typeof r.reversible === 'boolean'
    && SCOPES.includes(r.scope) && typeof r.money === 'boolean';

const projectOf = ({ params, task, run }) => String(
    (params && params.projectId) || (task && task.ProjectID) || (run && run.projectId) || '',
);

const escalations = (rating) => [
    !rating.reversible ? 'cannot be undone' : '',
    rating.scope !== 'task' ? `reaches the whole ${rating.scope}` : '',
    rating.money ? 'touches money' : '',
].filter(Boolean);

const decide = ({ agent = {}, action, params = {}, rating = null, run = null, task = null }) => {
    const key = String(action || '');
    const out = (decision, reason) => ({ decision, reason, rating: isComplete(rating) ? { ...rating } : null });
    const refuse = (reason) => out(DECISION.REFUSE, reason);

    if (isNever(key)) return refuse(`${key} is on the never-list`);
    if (!registry.has(key)) return refuse(`${key || '(unknown action)'} is not a registry action`);

    const allowed = Array.isArray(agent.allowedActions) ? agent.allowedActions.map(String) : [];
    if (allowed.length && !allowed.includes(key)) return refuse(`${key} is outside this agent's allowed actions`);

    const projects = Array.isArray(agent.projectIds) ? agent.projectIds.map(String) : [];
    const projectId = projectOf({ params, task, run });
    if (projects.length && !projects.includes(projectId)) return refuse(`project ${projectId || '(none)'} is outside this agent's projects`);

    const check = registry.evaluate(key, { ...params, __proposal: true }, { allowedActions: allowed });
    if (!check.allowed) return refuse(check.reason);
    if (!isComplete(rating)) return refuse(`${key} has no risk rating`);

    if (!rating.write) return out(DECISION.ACT, `${key} only reads`);
    const autonomy = Number(agent.autonomy) || 0;
    if (autonomy < REVIEW_LEVEL) return out(DECISION.PROPOSE, `autonomy L${autonomy} proposes every write`);

    const entry = registry.get(key);
    if (entry.proposeOnly || entry.gate) return out(DECISION.PROPOSE, `${key} must be proposed${entry.gate === 'owner_admin' ? ' to an owner or admin' : ''}`);
    const risky = escalations(rating);
    if (risky.length) return out(DECISION.PROPOSE, `${key} ${risky.join(', ')}`);
    return out(DECISION.ACT, `${key} is a reversible task-scoped write with no money in it`);
};

module.exports = { DECISION, SCOPES, REVIEW_LEVEL, decide, isNever, isComplete };

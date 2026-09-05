// The agent/person split, shared by the project generator and the router.
// WORK_KINDS and SKILL_INPUTS are the server copy of frontend/src/views/Ai/agentFit.js;
// tests/agent-split-parity.test.js fails when the two drift.

const { inputsOf, MIN_BRIEF_CHARS } = require('./taskInputs');

const READ_ACTIONS = ['tasks.next', 'tasks.search', 'task.get', 'docs.read'];

const WORK_KINDS = [
    {
        kind: 'human',
        label: 'a judgement call',
        labelKey: 'human_decision',
        whyKey: 'human_decision',
        test: /\b(decide|decision|choose|pick between|pricing|positioning|roadmap|strateg|approve|negotiat|hire|interview)\w*\b/i,
        why: 'It asks for a decision, and a decision needs someone accountable for it.'
    },
    {
        kind: 'human',
        label: 'talking to someone',
        labelKey: 'human_talk',
        whyKey: 'human_talk',
        test: /\b(call|phone|meet|meeting|vendor|customer|client visit|workshop|demo to)\w*\b/i,
        why: 'It happens outside the tool, with a person on the other end.'
    },
    {
        kind: 'code',
        label: 'change code and hand back a branch',
        labelKey: 'code',
        test: /\b(fix|bug|refactor|implement|migrate|upgrade|bump|dependenc|snapshot|failing|test|patch|typo in code)\w*\b/i,
        actions: ['task.get', 'task.comment', 'task.status.set', 'task.link'],
        skills: ['code', 'repo', 'pr', 'test', 'refactor', 'dependency']
    },
    {
        kind: 'review',
        label: 'find the problems and report them',
        labelKey: 'review',
        test: /\b(audit|review|check|contrast|accessib|a11y|copy|consistency|qa|verify)\w*\b/i,
        actions: ['task.get', 'task.comment'],
        skills: ['review', 'qa', 'audit', 'a11y', 'accessibility', 'design', 'copy', 'risk']
    },
    {
        kind: 'write',
        label: 'draft something for a person to approve',
        labelKey: 'write',
        test: /\b(write|draft|summar|release notes|changelog|digest|report|document)\w*\b/i,
        actions: ['task.get', 'page.draft', 'task.comment'],
        skills: ['write', 'digest', 'summary', 'report', 'docs', 'release']
    },
    {
        kind: 'plan',
        label: 'break the work down',
        labelKey: 'plan',
        test: /\b(plan|break down|estimate|scope|backlog|groom|split)\w*\b/i,
        actions: ['task.get', 'subtask.create', 'task.update'],
        skills: ['plan', 'brief', 'project', 'intake', 'scope']
    }
];

const FALLBACK_KIND = {
    kind: 'general',
    label: 'read it and comment',
    labelKey: 'general',
    actions: ['task.get', 'task.comment'],
    skills: []
};

const SKILL_INPUTS = [
    { match: /^(pr\.summary|risk\.flags)$/, code: 'pr_link', needs: (i) => Boolean(i.prUrl), reason: 'it needs a pull request link on the task' },
    { match: /^(qa-review|qa\.review)$/, code: 'public_url', needs: (i) => Boolean(i.publicUrl), reason: 'it needs a public URL to review' },
    { match: /^(brief\.parse|project\.plan)$/, code: 'brief', needs: (i) => i.briefChars >= MIN_BRIEF_CHARS, reason: `it needs a brief of at least ${MIN_BRIEF_CHARS} characters` },
    { match: /^(digest\..*|risk\.today)$/, code: 'project_task', needs: () => false, reason: 'it reports on a whole project, not on one task' }
];

const text = (v) => String(v == null ? '' : v);
const words = (v) => text(v).toLowerCase().match(/[a-z0-9]+/g) || [];

const taskText = (task = {}) => [task.TaskName, task.TaskKey, (task.tagsArray || []).join(' '), task.rawDescription || task.description]
    .map(text).join(' ');

const classifyTask = (task = {}) => {
    const body = taskText(task);
    const found = WORK_KINDS.find((k) => k.test.test(body));
    if (!found) return { ...FALLBACK_KIND, needsPerson: false };
    if (found.kind === 'human') return { kind: 'human', label: found.label, labelKey: found.labelKey, why: found.why, whyKey: found.whyKey, actions: [], skills: [], needsPerson: true };
    return { kind: found.kind, label: found.label, labelKey: found.labelKey, actions: found.actions, skills: found.skills, needsPerson: false };
};

const skillKeys = (agent) => (Array.isArray(agent.skills) ? agent.skills : [])
    .filter((s) => !(s && typeof s === 'object' && s.enabled === false))
    .map((s) => text(s && typeof s === 'object' ? (s.key || s.slug || s.name) : s).toLowerCase())
    .filter(Boolean);

const allowed = (agent) => (Array.isArray(agent.allowedActions) ? agent.allowedActions : []);
const canDo = (agent, action) => { const list = allowed(agent); return list.length ? list.includes(action) : true; };

const coversWork = (agent, work) => {
    const needed = work.actions.filter((a) => !READ_ACTIONS.includes(a));
    return !needed.length || needed.some((a) => canDo(agent, a));
};

const scopedTo = (agent, task) => {
    const projectId = task && task.ProjectID;
    if (!projectId || !Array.isArray(agent.projectIds) || !agent.projectIds.length) return true;
    return agent.projectIds.map(String).includes(String(projectId));
};

const skillFitsWork = (skill, work) => {
    const own = words(skill);
    return work.skills.some((w) => own.some((o) => o.includes(w) || w.includes(o)));
};

const inputRuleFor = (skill) => SKILL_INPUTS.find((r) => r.match.test(skill)) || null;

const person = (reason) => ({ label: 'person', skill: null, reason, need: null, agentId: null, agentName: null });

/* One task against the workspace's live agents. An agent takes the task only
 * through a named, runnable skill whose input the task already carries;
 * "agent-after" names the input a person still has to add. */
const splitFor = ({ task = {}, agents = [] } = {}) => {
    const work = classifyTask(task);
    if (work.needsPerson) return person(work.why);
    const inputs = inputsOf(task);
    let after = null;
    for (const agent of agents) {
        if (!agent || !scopedTo(agent, task) || !canDo(agent, 'task.get') || !coversWork(agent, work)) continue;
        for (const skill of skillKeys(agent)) {
            const rule = inputRuleFor(skill);
            if (!rule || !skillFitsWork(skill, work)) continue;
            if (rule.needs(inputs)) {
                return { label: 'agent', skill, reason: `${agent.name || 'An agent'} can run ${skill} on it`, need: null, agentId: String(agent._id || ''), agentName: agent.name || '' };
            }
            if (!after) after = { label: 'agent-after', skill, reason: `${agent.name || 'An agent'} could run ${skill} once a person adds what it needs — ${rule.reason}`, need: rule.code, agentId: String(agent._id || ''), agentName: agent.name || '' };
        }
    }
    if (after) return after;
    if (work.kind === 'general') return person('no agent here has a skill for this kind of work');
    return person(`no agent here has a skill that would ${work.label}`);
};

const splitSummary = (splits = []) => splits.reduce((acc, s) => {
    if (!s) return acc;
    if (s.label === 'agent') acc.agent += 1;
    else if (s.label === 'agent-after') acc.agentAfter += 1;
    else acc.person += 1;
    return acc;
}, { agent: 0, agentAfter: 0, person: 0 });

module.exports = { WORK_KINDS, FALLBACK_KIND, SKILL_INPUTS, READ_ACTIONS, classifyTask, splitFor, splitSummary, skillKeys };

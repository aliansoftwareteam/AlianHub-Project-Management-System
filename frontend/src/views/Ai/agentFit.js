// Fit ranking for the assignee picker (handoff 30a).
//
// "Fit" is computed from three things this workspace actually knows: the actions
// the agent is allowed to perform (from the server action registry), the skills
// it declares, and its own run history on tasks like this one. It is never a
// vendor benchmark, and an agent with no history here shows "no history yet"
// rather than a number nobody can account for.
//
// Pure — no network, no store, no Vue. Tested in tests/agent-fit.test.js.

const READ_ACTIONS = ['tasks.next', 'tasks.search', 'task.get', 'docs.read'];

/* What a task of this shape needs done to it. Ordered: the first kind that
 * matches wins, so "fix the failing accessibility tests" is code work, not a
 * report. */
const WORK_KINDS = [
    {
        kind: 'human',
        label: 'a judgement call',
        test: /\b(decide|decision|choose|pick between|pricing|positioning|roadmap|strateg|approve|negotiat|hire|interview)\w*\b/i,
        why: 'It asks for a decision, and a decision needs someone accountable for it.'
    },
    {
        kind: 'human',
        label: 'talking to someone',
        test: /\b(call|phone|meet|meeting|vendor|customer|client visit|workshop|demo to)\w*\b/i,
        why: 'It happens outside the tool, with a person on the other end.'
    },
    {
        kind: 'code',
        label: 'change code and hand back a branch',
        test: /\b(fix|bug|refactor|implement|migrate|upgrade|bump|dependenc|snapshot|failing|test|patch|typo in code)\w*\b/i,
        actions: ['task.get', 'task.comment', 'task.status.set', 'task.link'],
        skills: ['code', 'repo', 'pr', 'test', 'refactor', 'dependency']
    },
    {
        kind: 'review',
        label: 'find the problems and report them',
        test: /\b(audit|review|check|contrast|accessib|a11y|copy|consistency|qa|verify)\w*\b/i,
        actions: ['task.get', 'task.comment'],
        skills: ['review', 'qa', 'audit', 'a11y', 'accessibility', 'design', 'copy', 'risk']
    },
    {
        kind: 'write',
        label: 'draft something for a person to approve',
        test: /\b(write|draft|summar|release notes|changelog|digest|report|document)\w*\b/i,
        actions: ['task.get', 'page.draft', 'task.comment'],
        skills: ['write', 'digest', 'summary', 'report', 'docs', 'release']
    },
    {
        kind: 'plan',
        label: 'break the work down',
        test: /\b(plan|break down|estimate|scope|backlog|groom|split)\w*\b/i,
        actions: ['task.get', 'subtask.create', 'task.update'],
        skills: ['plan', 'brief', 'project', 'intake', 'scope']
    }
];

const FALLBACK_KIND = {
    kind: 'general',
    label: 'read it and comment',
    actions: ['task.get', 'task.comment'],
    skills: []
};

const text = (v) => String(v == null ? '' : v);
const words = (v) => text(v).toLowerCase().match(/[a-z0-9]+/g) || [];
const uniq = (list) => [...new Set(list)];
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const median = (list) => {
    const sorted = list.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const taskText = (task = {}) => [task.TaskName, task.TaskKey, (task.tagsArray || []).join(' '), task.rawDescription || task.description]
    .map(text).join(' ');

/* The kind of work a task is. Exported so the bulk router (30b) and the picker
 * agree on what a task needs — a router that classified differently from the
 * picker would recommend agents the picker calls ineligible. */
const classifyTask = (task = {}) => {
    const body = taskText(task);
    const found = WORK_KINDS.find((k) => k.test.test(body));
    if (!found) return { ...FALLBACK_KIND, needsPerson: false };
    if (found.kind === 'human') return { kind: 'human', label: found.label, why: found.why, actions: [], skills: [], needsPerson: true };
    return { kind: found.kind, label: found.label, actions: found.actions, skills: found.skills, needsPerson: false };
};

const allowed = (agent) => (Array.isArray(agent.allowedActions) ? agent.allowedActions : []);
const skillNames = (agent) => (Array.isArray(agent.skills) ? agent.skills : []).map((s) => text(s.key || s.name || s).toLowerCase());

/* An agent with an empty allowedActions list has never been narrowed, so the
 * registry's full vocabulary applies — the same rule the server guard uses. */
const canDo = (agent, action) => {
    const list = allowed(agent);
    return list.length ? list.includes(action) : true;
};

const monthSpend = (agent) => Number((agent.spendMonth && agent.spendMonth.usd) || 0);
const capReached = (agent) => Number(agent.spendCapUsd) > 0 && monthSpend(agent) >= Number(agent.spendCapUsd);

/* This agent's own runs against tasks of the same kind. `runs` is the raw list
 * from GET /api/v2/agents/runs. */
const historyFor = (agent, runs = [], kind = '') => {
    const mine = runs.filter((r) => String(r.agentId) === String(agent._id));
    const similar = kind && kind !== 'general' ? mine.filter((r) => text(r.kind || r.skill).toLowerCase().includes(kind)) : [];
    const pool = similar.length >= 3 ? similar : mine;
    const finished = pool.filter((r) => ['done', 'failed', 'stopped'].includes(text(r.status)));
    const good = finished.filter((r) => r.status === 'done');
    return {
        runs: pool.length,
        finished: finished.length,
        good: good.length,
        similar: similar.length,
        successRate: finished.length ? good.length / finished.length : null,
        medianUsd: median(good.map((r) => Number((r.spend && r.spend.usd) || 0))),
        medianMinutes: median(good.map((r) => Math.round(Number(r.elapsedMs || 0) / 60000)))
    };
};

const skillOverlap = (agent, work, task) => {
    const declared = skillNames(agent).join(' ');
    const declaredWords = uniq(words(declared));
    if (!declaredWords.length) return 0;
    const wanted = uniq(work.skills.concat(words(taskText(task))));
    const hits = declaredWords.filter((w) => wanted.some((t) => t.includes(w) || w.includes(t)));
    return Math.min(1, hits.length / Math.max(2, work.skills.length || 2));
};

const coverage = (agent, work) => {
    const needed = work.actions.filter((a) => !READ_ACTIONS.includes(a));
    if (!needed.length) return 1;
    return needed.filter((a) => canDo(agent, a)).length / needed.length;
};

const ineligibility = (agent, work, { projectId } = {}) => {
    if (work.needsPerson) return `This needs a person — ${work.why}`;
    if (agent.paused) return `Paused${agent.pausedReason ? ` (${agent.pausedReason})` : ''}.`;
    if (capReached(agent)) return `Spend cap reached — $${round2(monthSpend(agent))} of $${agent.spendCapUsd} this month.`;
    if (projectId && Array.isArray(agent.projectIds) && agent.projectIds.length && !agent.projectIds.map(String).includes(String(projectId))) {
        return 'Not scoped to this project.';
    }
    if (!canDo(agent, 'task.get')) return 'It cannot read a task.';
    if (coverage(agent, work) === 0) return `It has no allowed action that would ${work.label}.`;
    return '';
};

const reasonFor = (agent, work, cover, history) => {
    const parts = [];
    if (cover >= 1) parts.push(`Allowed to ${work.label}.`);
    else parts.push(`Can start, but it may only ${allowed(agent).filter((a) => !READ_ACTIONS.includes(a)).length ? 'do part of this' : 'read and comment'} — you would get a list, not a fix.`);
    if (history.runs) {
        const scope = history.similar >= 3 ? `${history.similar} similar` : `${history.runs}`;
        parts.push(`${scope} run${history.runs === 1 ? '' : 's'} here, ${history.good} finished clean.`);
    } else {
        parts.push('No history in this workspace yet.');
    }
    return parts.join(' ');
};

/* What it will and will not do, straight from the server registry so the copy
 * cannot drift from the guard that enforces it. */
const boundaries = (agent, registryActions = [], never = []) => {
    const writes = registryActions.filter((a) => a.write);
    const will = writes.filter((a) => canDo(agent, a.key)).map((a) => a.label);
    const wont = writes.filter((a) => !canDo(agent, a.key)).map((a) => a.label).concat(never);
    return { will, wont };
};

const estimateFor = (history) => {
    if (!history.good) return { minutes: null, usd: null, basis: 'no history yet' };
    return {
        minutes: history.medianMinutes,
        usd: history.medianUsd === null ? null : round2(history.medianUsd),
        basis: `median of ${history.good} finished run${history.good === 1 ? '' : 's'}`
    };
};

/* One agent against one task. */
const fitFor = ({ agent, task, runs = [], registryActions = [], never = [] }) => {
    const work = classifyTask(task);
    const blocked = ineligibility(agent, work, { projectId: task && task.ProjectID });
    const history = historyFor(agent, runs, work.kind);
    const cover = coverage(agent, work);
    const skill = skillOverlap(agent, work, task);
    const { will, wont } = boundaries(agent, registryActions, never);

    // Weights renormalise when there is no history, so a new agent is ranked on
    // what it is allowed to do rather than penalised for a number it cannot have.
    const hasHistory = history.finished > 0;
    const raw = hasHistory
        ? (cover * 0.45) + (skill * 0.25) + (history.successRate * 0.30)
        : (cover * 0.64) + (skill * 0.36);

    return {
        agentId: String(agent._id || ''),
        name: agent.name || '',
        eligible: !blocked,
        blockedReason: blocked,
        work,
        score: blocked ? 0 : Math.round(raw * 1000) / 1000,
        percent: blocked || !hasHistory ? null : Math.round(raw * 100),
        noHistory: !hasHistory,
        reason: blocked || reasonFor(agent, work, cover, history),
        coverage: Math.round(cover * 100) / 100,
        history,
        estimate: estimateFor(history),
        will,
        wont
    };
};

/* Every agent against one task, best first. Ineligible agents keep their place
 * at the bottom with the reason — hiding them is how a picker teaches people
 * that agents are unpredictable. */
const rankAgents = ({ agents = [], task = {}, runs = [], registryActions = [], never = [] }) => agents
    .map((agent) => fitFor({ agent, task, runs, registryActions, never }))
    .sort((a, b) => {
        if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
        if (b.score !== a.score) return b.score - a.score;
        return text(a.name).localeCompare(text(b.name));
    });

/* Bulk routing (30b): one proposed assignee per task, and an explicit refusal
 * for the tasks that need a person. A router that assigns everything is a router
 * nobody trusts twice. */
const routeTasks = ({ tasks = [], agents = [], runs = [], registryActions = [], never = [], minScore = 0.45 }) => tasks.map((task) => {
    const ranked = rankAgents({ agents, task, runs, registryActions, never });
    const best = ranked.find((r) => r.eligible && r.score >= minScore) || null;
    const work = classifyTask(task);
    return {
        taskId: String(task._id || task.taskId || ''),
        title: task.TaskName || '',
        work,
        agent: best,
        ranked,
        routed: Boolean(best),
        refusal: best ? '' : (work.needsPerson ? `needs a person — ${work.why}` : 'no agent here is allowed to do this')
    };
});

const routingTotals = (rows = []) => {
    const routed = rows.filter((r) => r.routed);
    const usd = routed.reduce((sum, r) => sum + Number((r.agent && r.agent.estimate && r.agent.estimate.usd) || 0), 0);
    return { routed: routed.length, forPeople: rows.length - routed.length, usd: round2(usd), priced: routed.filter((r) => r.agent.estimate.usd !== null).length };
};

module.exports = { classifyTask, fitFor, rankAgents, routeTasks, routingTotals, historyFor, WORK_KINDS, READ_ACTIONS };

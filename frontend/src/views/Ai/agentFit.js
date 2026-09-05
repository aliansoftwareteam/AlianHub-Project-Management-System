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
    if (found.kind === 'human') return { kind: 'human', label: found.label, labelKey: found.labelKey, why: found.why, whyKey: found.whyKey, actions: [], skills: [], needsPerson: true };
    return { kind: found.kind, label: found.label, labelKey: found.labelKey, actions: found.actions, skills: found.skills, needsPerson: false };
};

const allowed = (agent) => (Array.isArray(agent.allowedActions) ? agent.allowedActions : []);
const skillNames = (agent) => (Array.isArray(agent.skills) ? agent.skills : []).map((s) => text(s.key || s.name || s).toLowerCase());

/* What each executable skill needs from the task before it can do anything.
 * `/api/v2/agents/routable` sends these as task.inputs; the picker derives them
 * from the full task. Skills not listed here have no known requirement. */
const MIN_BRIEF_CHARS = 40;
const URL_RE = /https?:\/\/[^\s<>"')]+/gi;
const PR_RE = /\/pull\/\d+|\/merge_requests\/\d+|\/compare\//;
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|0\.0\.0\.0|\[?::1)/i;
const SKILL_INPUTS = [
    { match: /^(pr\.summary|risk\.flags)$/, code: 'pr_link', needs: (i) => Boolean(i.prUrl), reason: 'it needs a pull request link on the task' },
    { match: /^(qa-review|qa\.review)$/, code: 'public_url', needs: (i) => Boolean(i.publicUrl), reason: 'it needs a public URL to review' },
    { match: /^(brief\.parse|project\.plan)$/, code: 'brief', needs: (i) => i.briefChars >= MIN_BRIEF_CHARS, reason: `it needs a brief of at least ${MIN_BRIEF_CHARS} characters` },
    { match: /^(digest\..*|risk\.today)$/, code: 'project_task', needs: () => false, reason: 'it reports on a whole project, not on one task' }
];

const hostOf = (url) => { try { return new URL(url).hostname; } catch (e) { return ''; } };
const isPublic = (url) => { const h = hostOf(url); return Boolean(h) && !PRIVATE_HOST.test(h); };
const plain = (html) => text(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const taskInputs = (task = {}) => {
    if (task.inputs && typeof task.inputs === 'object') return { prUrl: task.inputs.prUrl || null, publicUrl: task.inputs.publicUrl || null, briefChars: Number(task.inputs.briefChars) || 0 };
    const links = Array.isArray(task.links) ? task.links : [];
    const urls = [task.TaskName, task.description, task.rawDescription].map(text).join(' ').match(URL_RE) || [];
    const prLink = links.find((l) => /^(pr|branch)$/i.test(text(l.kind)) && l.url) || links.find((l) => PR_RE.test(text(l.url)));
    const linkedPage = links.map((l) => text(l.url)).find((u) => /^https?:\/\//i.test(u) && !PR_RE.test(u) && isPublic(u));
    return {
        prUrl: prLink ? text(prLink.url) : (urls.find((u) => PR_RE.test(u)) || null),
        publicUrl: linkedPage || urls.find((u) => !PR_RE.test(u) && isPublic(u)) || null,
        briefChars: plain(task.description || task.rawDescription).length
    };
};

/* Why none of the agent's skills can start on this task, as { reason, code }
 * (code = the Ai.req_* line), or null when at least one can or has no known
 * requirement. */
const missingInput = (agent, task) => {
    const inputs = taskInputs(task);
    const known = skillNames(agent).map((s) => ({ skill: s, rule: SKILL_INPUTS.find((r) => r.match.test(s)) })).filter((k) => k.rule);
    if (!known.length) return null;
    const unmet = known.filter((k) => !k.rule.needs(inputs));
    if (unmet.length < known.length) return null;
    return { reason: unmet[0].rule.reason, code: unmet[0].rule.code };
};

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
    // A skipped run (no URL, no PR, brief too short) says nothing about the agent,
    // so it counts neither as clean nor as a failure.
    const finished = pool.filter((r) => ['done', 'failed', 'stopped'].includes(text(r.status)));
    const good = finished.filter((r) => r.status === 'done');
    const skipped = pool.filter((r) => r.status === 'skipped');
    return {
        runs: pool.length,
        finished: finished.length,
        good: good.length,
        skipped: skipped.length,
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

/* Every reason carries a code and params next to its English text, so a
 * component can render it through $t while this file stays free of i18n. */
const NOT_BLOCKED = { text: '', code: '', params: {} };

const ineligibility = (agent, work, task = {}) => {
    if (work.needsPerson) return { text: `This needs a person — ${work.why}`, code: 'needs_person', params: { why: work.whyKey } };
    if (agent.paused) return { text: `Paused${agent.pausedReason ? ` (${agent.pausedReason})` : ''}.`, code: 'paused', params: { reason: agent.pausedReason || '' } };
    if (capReached(agent)) {
        return { text: `Spend cap reached — $${round2(monthSpend(agent))} of $${agent.spendCapUsd} this month.`, code: 'cap_reached', params: { spent: round2(monthSpend(agent)).toFixed(2), cap: agent.spendCapUsd } };
    }
    const projectId = task && task.ProjectID;
    if (projectId && Array.isArray(agent.projectIds) && agent.projectIds.length && !agent.projectIds.map(String).includes(String(projectId))) {
        return { text: 'Not scoped to this project.', code: 'not_scoped', params: {} };
    }
    if (!canDo(agent, 'task.get')) return { text: 'It cannot read a task.', code: 'cannot_read', params: {} };
    if (coverage(agent, work) === 0) return { text: `It has no allowed action that would ${work.label}.`, code: 'no_action', params: { work: work.labelKey } };
    const missing = missingInput(agent, task);
    if (missing) return { text: `This task lacks what it needs — ${missing.reason}.`, code: 'lacks_input', params: { need: missing.code } };
    return NOT_BLOCKED;
};

const reasonFor = (agent, work, cover, history) => {
    const parts = [];
    if (cover >= 1) parts.push({ text: `Allowed to ${work.label}.`, code: 'allowed', params: { work: work.labelKey } });
    else if (allowed(agent).filter((a) => !READ_ACTIONS.includes(a)).length) parts.push({ text: 'Can start, but it may only do part of this — you would get a list, not a fix.', code: 'partial', params: {} });
    else parts.push({ text: 'Can start, but it may only read and comment — you would get a list, not a fix.', code: 'read_only', params: {} });
    if (history.runs) {
        const similar = history.similar >= 3;
        const n = similar ? history.similar : history.runs;
        const scope = similar ? `${history.similar} similar` : `${history.runs}`;
        parts.push({ text: `${scope} run${history.runs === 1 ? '' : 's'} here, ${history.good} finished clean.`, code: similar ? 'history_similar' : 'history', params: { n, good: history.good } });
        if (history.skipped) parts.push({ text: `${history.skipped} skipped for missing input.`, code: 'history_skipped', params: { n: history.skipped } });
    } else {
        parts.push({ text: 'No history in this workspace yet.', code: 'no_history', params: {} });
    }
    return parts;
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
    const blockedBy = ineligibility(agent, work, task);
    const blocked = blockedBy.text;
    const missing = missingInput(agent, task);
    const history = historyFor(agent, runs, work.kind);
    const cover = coverage(agent, work);
    const skill = skillOverlap(agent, work, task);
    const { will, wont } = boundaries(agent, registryActions, never);
    const reasons = blocked ? [blockedBy] : reasonFor(agent, work, cover, history);

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
        missingInput: missing,
        work,
        score: blocked ? 0 : Math.round(raw * 1000) / 1000,
        percent: blocked || !hasHistory ? null : Math.round(raw * 100),
        noHistory: !hasHistory,
        reason: reasons.map((r) => r.text).join(' '),
        reasons,
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
    const lacking = best ? null : ranked.find((r) => r.missingInput);
    const refusal = best ? NOT_BLOCKED
        : work.needsPerson ? { text: `needs a person — ${work.why}`, code: 'needs_person', params: { why: work.whyKey } }
            : lacking ? { text: `needs a person — ${lacking.missingInput.reason}`, code: 'needs_input', params: { need: lacking.missingInput.code } }
                : { text: 'no agent here is allowed to do this', code: 'no_agent', params: {} };
    return {
        taskId: String(task._id || task.taskId || ''),
        title: task.TaskName || '',
        work,
        agent: best,
        ranked,
        routed: Boolean(best),
        refusal: refusal.text,
        refusalCode: refusal.code,
        refusalParams: refusal.params
    };
});

const routingTotals = (rows = []) => {
    const routed = rows.filter((r) => r.routed);
    const usd = routed.reduce((sum, r) => sum + Number((r.agent && r.agent.estimate && r.agent.estimate.usd) || 0), 0);
    return { routed: routed.length, forPeople: rows.length - routed.length, usd: round2(usd), priced: routed.filter((r) => r.agent.estimate.usd !== null).length };
};

module.exports = { classifyTask, fitFor, rankAgents, routeTasks, routingTotals, historyFor, taskInputs, missingInput, WORK_KINDS, READ_ACTIONS, SKILL_INPUTS };

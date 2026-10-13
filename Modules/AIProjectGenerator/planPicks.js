'use strict';

const planLocks = require('../Agents/planLocks');

// The parts of a generator plan, named on the shared plan card (frontend IntentPreview) as "<part>:<place>": its
// lists (the sprints), its tasks counted across the lists in order, its views, its rules and the project's Guide
// agent. The picks sent back at /execute can only leave parts out: a place the plan does not hold is ignored, a part
// the person may not make is left out whatever is ticked, and a task goes with its list.

const PARTS = Object.freeze(['lists', 'tasks', 'views', 'rules', 'agents']);
const REFUSED = Object.freeze({
    shape: 'The chosen parts must name, for each kind of part of the plan, the places to keep.',
    noList: 'Keep at least one list of the plan.',
});

const listOf = (value) => (Array.isArray(value) ? value : []);
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const keyOf = (part, at) => `${part}:${at}`;

const sprintsOf = (plan) => listOf(plan && plan.sprints);
const tasksIn = (plan) => sprintsOf(plan).flatMap((sprint, list) => listOf(sprint && sprint.tasks).map((task, at) => ({ list, at })));

const countsOf = (plan, { withGuide = false } = {}) => ({
    lists: sprintsOf(plan).length,
    tasks: tasksIn(plan).length,
    views: listOf(plan && plan.views).length,
    rules: listOf(plan && plan.rules).length,
    agents: withGuide ? 1 : 0,
});

/* The parts the person may not make, by key, with why: a rule needs an owner or an admin, and a view needs the role's
 * right to add one in a new project. The makers check again as the person; this only says it before anything is made. */
const locksFor = async ({ companyId, uid, plan }) => {
    const locks = new Map();
    const rules = listOf(plan && plan.rules);
    if (rules.length) {
        const may = await require('../Agents/automationRequests').mayManage(companyId, uid).catch(() => false);
        if (!may) rules.forEach((rule, at) => locks.set(keyOf('rules', at), planLocks.WHY.OWNER_ADMIN));
    }
    const views = listOf(plan && plan.views);
    if (views.length) {
        const refused = await require('../Agents/projectCreate').refusedFor(companyId, uid, { views }).catch(() => ({ project: '', parts: [] }));
        if (!refused.project && refused.parts.some((entry) => entry.part === 'views')) views.forEach((view, at) => locks.set(keyOf('views', at), planLocks.WHY.OWN_RIGHTS));
    }
    return locks;
};

const marksOf = (locks) => (locks.size ? { locked: [...locks.keys()], lockedWhy: Object.fromEntries(locks) } : { locked: [], lockedWhy: {} });

const placesOf = (picks, part, count) => new Set(listOf(picks[part]).filter((at) => Number.isInteger(at) && at >= 0 && at < count));

/* The plan with only the parts kept, and whether the Guide agent is made; or why the picks cannot be followed.
 * No picks keeps every part the person may make, as the generator always did. */
const narrow = (plan, picks, { withGuide = false, locks = new Map() } = {}) => {
    if (picks !== undefined && picks !== null && !isRecord(picks)) return { error: REFUSED.shape };
    const counts = countsOf(plan, { withGuide });
    const kept = Object.fromEntries(PARTS.map((part) => {
        const places = isRecord(picks) ? placesOf(picks, part, counts[part]) : new Set(Array.from({ length: counts[part] }, (_, at) => at));
        return [part, new Set([...places].filter((at) => !locks.has(keyOf(part, at))))];
    }));
    if (counts.lists && !kept.lists.size) return { error: REFUSED.noList };
    let flat = 0;
    const sprints = sprintsOf(plan).flatMap((sprint, list) => {
        const tasks = listOf(sprint.tasks).filter(() => kept.tasks.has(flat++));
        return kept.lists.has(list) ? [{ ...sprint, tasks }] : [];
    });
    const narrowed = {
        ...plan,
        sprints,
        views: listOf(plan.views).filter((view, at) => kept.views.has(at)),
        rules: listOf(plan.rules).filter((rule, at) => kept.rules.has(at)),
    };
    return { plan: narrowed, withGuideAgent: withGuide && kept.agents.has(0) };
};

module.exports = { PARTS, REFUSED, keyOf, countsOf, locksFor, marksOf, narrow };

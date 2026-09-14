// What the open backlog looks like to the agent engine, before any model is
// called: GET /api/v2/agents/routable is a plain scoped query and classifyTask
// is a regex, so the landing screen can open with real work on day one instead
// of a wall of zeros.
//
// Pure — no network, no store, no Vue, no i18n. Required by path rather than by
// the @agentWork alias so the node test runner can load it directly, the same
// reason agentFit.js does.

const agentWork = require('../../../../Modules/Agents/workKinds');

const { classifyTask, hasInput, requiresOf, skillKeyOf } = agentWork;

/* Kinds an agent can act on, most actionable first. A kind absent from the
 * backlog is absent from the screen — the counts are never padded. */
const KIND_ORDER = ['review', 'code', 'write', 'plan', 'general'];

const rank = (labelKey) => {
    const at = KIND_ORDER.indexOf(labelKey);
    return at === -1 ? KIND_ORDER.length : at;
};

const backlogRead = (tasks = []) => {
    const groups = new Map();
    const people = [];

    tasks.forEach((task) => {
        const work = classifyTask(task);
        if (work.needsPerson) {
            people.push({ task, work });
            return;
        }
        const group = groups.get(work.labelKey) || { labelKey: work.labelKey, kind: work.kind, work, tasks: [] };
        group.tasks.push(task);
        groups.set(work.labelKey, group);
    });

    const ordered = [...groups.values()].sort((a, b) => (rank(a.labelKey) - rank(b.labelKey)) || (b.tasks.length - a.tasks.length));

    return {
        total: tasks.length,
        groups: ordered,
        people,
        needsPerson: people.length,
        whyKeys: [...new Set(people.map((p) => p.work.whyKey))]
    };
};

/* How far each skill in the library reaches into this backlog. A skill that
 * reports on a whole project can never be counted in tasks, so it says so
 * rather than showing a zero it would always show. */
const skillReach = (skills = [], tasks = []) => (Array.isArray(skills) ? skills : []).map((skill) => {
    const requires = requiresOf(skill) || null;
    const scope = requires ? requires.scope || 'task' : 'task';
    return {
        key: skillKeyOf(skill),
        name: skill.name || skillKeyOf(skill),
        requires,
        scope,
        matches: scope === 'project' ? null : (requires ? tasks.filter((task) => hasInput(requires.code, task)).length : tasks.length)
    };
});

module.exports = { backlogRead, skillReach, KIND_ORDER };

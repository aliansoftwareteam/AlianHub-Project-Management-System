// Required by path rather than through the @agentWork alias so the node test
// runner can load it directly, the same reason agentFit.js does.

const agentWork = require('../../../../Modules/Agents/workKinds');

const { classifyTask, hasInput, requiresOf, skillKeyOf, FALLBACK_KIND } = agentWork;

const KIND_ORDER = ['review', 'code', 'write', 'plan'];

const rank = (labelKey) => {
    const at = KIND_ORDER.indexOf(labelKey);
    return at === -1 ? KIND_ORDER.length : at;
};

const backlogRead = (tasks = []) => {
    const groups = new Map();
    const people = [];
    const unshaped = [];

    tasks.forEach((task) => {
        const work = classifyTask(task);
        if (work.needsPerson) {
            people.push({ task, work });
            return;
        }
        /* The fallback kind is what is left when no rule matched, so nothing was
         * recognised about the task. Offering it as work an agent could take
         * would be a guess dressed as a read. */
        if (work.labelKey === FALLBACK_KIND.labelKey) {
            unshaped.push(task);
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
        unshaped: unshaped.length,
        whyKeys: [...new Set(people.map((p) => p.work.whyKey))]
    };
};

/* A skill that reports on a whole project can never be counted in tasks, so it
 * says so rather than showing a zero it would always show. */
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

/* With every task unshaped there is nothing to list after the dash, so the line stops at the count. */
const readLineKey = ({ capped = false, hasParts = true } = {}) => `AiLanding.read_line${capped ? '_capped' : ''}${hasParts ? '' : '_plain'}`;

module.exports = { backlogRead, skillReach, readLineKey, KIND_ORDER };

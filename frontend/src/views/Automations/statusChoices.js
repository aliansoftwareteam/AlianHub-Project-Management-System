// A status condition stores `<projectId>:<key>` refs (Modules/Automations/helpers/statusConditions);
// the builder offers each status name once, carrying every project's key for it.

const fold = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

const statusesOf = (project) => (Array.isArray(project?.taskStatusData) ? project.taskStatusData : [])
    .map((row) => (row && row.convertStatus ? row.convertStatus : row))
    .filter((s) => s && s.key !== undefined && s.key !== null && s.name);

export const statusChoices = (projects = [], scopeChoice = 'all') => {
    const byName = new Map();
    (projects || [])
        .filter((p) => scopeChoice === 'all' || String(p._id) === String(scopeChoice))
        .forEach((project) => statusesOf(project).forEach((s) => {
            const name = fold(s.name);
            if (!byName.has(name)) byName.set(name, { label: String(s.name), refs: [] });
            byName.get(name).refs.push(`${project._id}:${s.key}`);
        }));
    return [...byName.values()];
};

/* The picker's options for one condition, keeping a stored name the projects no longer have so it still shows. */
export const choicesFor = (condition, projects, scopeChoice) => {
    const choices = statusChoices(projects, scopeChoice);
    if (!condition.label || choices.some((c) => fold(c.label) === fold(condition.label))) return choices;
    return [{ label: condition.label, refs: Array.isArray(condition.value) ? condition.value : [] }, ...choices];
};

export const refsFor = (label, projects, scopeChoice) => (statusChoices(projects, scopeChoice).find((c) => fold(c.label) === fold(label)) || { refs: [] }).refs;

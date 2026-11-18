// Which skill needs which input, answered from the skill's own manifest entry
// instead of a hand-kept table. A skill declares `inputs`; the catalogue says
// what each one means, whether the task carries it, and how to say what is
// missing. The board split, the router and the pickers all ask here.

const { INPUT_CATALOGUE, hasInput } = require('./catalogues');

const DEFAULT_REQUIREMENT = 'task';

const entryOf = (code) => INPUT_CATALOGUE[code] || null;

const inputsDeclaredBy = (skill) => {
    const list = skill && Array.isArray(skill.inputs) ? skill.inputs : [];
    return list.map(String).filter((code) => entryOf(code));
};

/* A skill that reads a whole project is never the agent for one task, however
 * complete that task is. */
const isProjectScoped = (skill) => inputsDeclaredBy(skill).some((code) => entryOf(code).scope === 'project');

/* The single input a picker names as this skill's requirement; skills that
 * declare none work from the task alone. */
const requirementOf = (skill) => inputsDeclaredBy(skill)[0] || DEFAULT_REQUIREMENT;

const requirementsOf = (skills = []) => [...new Set(skills.map(requirementOf))];

/* The input that decides whether this skill can start: the project-scoped one
 * when it declares one, else the first it declares. Travels on the manifest so
 * a picker states the requirement without a table of its own. */
const requirementDetail = (skill) => {
    const codes = inputsDeclaredBy(skill);
    const code = codes.find((c) => entryOf(c).scope === 'project') || codes[0];
    if (!code) return null;
    const entry = entryOf(code);
    return { code, needs: entry.needs, scope: entry.scope };
};

/* The first declared input the task does not carry, as { code, reason, missing },
 * or null when the skill can start. `reason` is the short form; `missing` is the
 * catalogue's account of what this particular task lacks. */
const missingInputFor = (skill, task = {}) => {
    const codes = inputsDeclaredBy(skill);
    const blocked = isProjectScoped(skill) ? codes.find((code) => entryOf(code).scope === 'project') : null;
    if (blocked) return { code: blocked, reason: entryOf(blocked).needs, missing: entryOf(blocked).needs };
    const code = codes.find((c) => !hasInput(c, task));
    if (!code) return null;
    return { code, reason: entryOf(code).needs, missing: entryOf(code).missing(task) };
};

module.exports = { DEFAULT_REQUIREMENT, inputsDeclaredBy, isProjectScoped, requirementOf, requirementsOf, requirementDetail, missingInputFor };

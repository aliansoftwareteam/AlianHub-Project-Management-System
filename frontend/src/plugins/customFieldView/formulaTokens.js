/* The name a formula uses for a field is the field's own name in braces, in every editor. The server also reads the
   older lower_case form of that name (computeFields.js aliasesOf), so a stored formula keeps working. */

/* The task's own numbers (computeFields.js builtinScope). `priority` is left out: a priority is stored as a word. */
const BUILTINS = ['subtask_count', 'estimate', 'remaining_hours', 'logged_hours'];
const TASK_SOURCE = 'task';

const braced = (name) => `{${name}}`;
const slugOf = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
const titleOf = (value) => String(value || '').trim();
const unique = (list) => [...new Set(list.filter(Boolean))];

export const BUILTIN_TOKENS = BUILTINS.map(braced);

export const tokenOf = (field) => braced(titleOf(field?.fieldTitle));

export const tokensOfFields = (fields) => unique([...BUILTINS, ...(fields || []).map((field) => titleOf(field?.fieldTitle))]).map(braced);

/* `names` is what GET /api/v2/custom-fields/formula/scope answers: the task's own numbers, then the fields. */
export const tokensFrom = (names) => unique([
    ...BUILTINS,
    ...(names || []).filter((entry) => entry?.source !== TASK_SOURCE).map((entry) => titleOf(entry?.title) || entry?.name)
]).map(braced);

/* Every name a formula may still use, each with a number to try the formula on. */
export function sampleFrom(names) {
    const sample = {};
    BUILTINS.forEach((name, index) => { sample[name] = index + 1; });
    (names || []).forEach((entry, index) => {
        unique([entry?.name, titleOf(entry?.title), slugOf(entry?.title)]).forEach((name) => { sample[name] = index + 1; });
    });
    return sample;
}

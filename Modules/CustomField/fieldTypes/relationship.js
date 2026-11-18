const { isBlank, wholeNumberOf } = require('./shared');

const TASK_ID = /^[a-f0-9]{24}$/i;
const DEFAULT_MAX = 10;
const MAX_RANGE = Object.freeze({ min: 1, max: 20 });
const SCOPES = Object.freeze(['any', 'project', 'list']);

const NOT_A_LIST = 'A relationship field holds a list of tasks.';

const isId = (value) => typeof value === 'string' && TASK_ID.test(value);

const maxOf = (definition) => {
    const max = wholeNumberOf(definition && definition.fieldLinkMax);
    return max !== null && max >= MAX_RANGE.min && max <= MAX_RANGE.max ? max : DEFAULT_MAX;
};

/* Where the tasks a field links may come from: any project the person can open, one project, or one list of it. */
const scopeOf = (definition) => {
    const scope = definition && SCOPES.includes(definition.fieldLinkScope) ? definition.fieldLinkScope : 'any';
    const projectId = scope !== 'any' && isId(definition.fieldLinkProjectId) ? definition.fieldLinkProjectId.toLowerCase() : '';
    const sprintId = scope === 'list' && isId(definition.fieldLinkSprintId) ? definition.fieldLinkSprintId.toLowerCase() : '';
    return { scope, projectId, sprintId };
};

function settings(definition) {
    const max = isBlank(definition.fieldLinkMax) ? DEFAULT_MAX : wholeNumberOf(definition.fieldLinkMax);
    if (max === null || max < MAX_RANGE.min || max > MAX_RANGE.max) return { error: `A relationship field links at most a whole number of tasks from ${MAX_RANGE.min} to ${MAX_RANGE.max}.` };
    const scope = isBlank(definition.fieldLinkScope) ? 'any' : definition.fieldLinkScope;
    if (!SCOPES.includes(scope)) return { error: `A relationship field links tasks of ${SCOPES.join(', ')}.` };
    if (scope !== 'any' && !isId(definition.fieldLinkProjectId)) return { error: 'A relationship field limited to a project or a list names that project.' };
    if (scope === 'list' && !isId(definition.fieldLinkSprintId)) return { error: 'A relationship field limited to a list names that list.' };
    return {
        settings: {
            fieldLinkMax: max,
            fieldLinkScope: scope,
            fieldLinkProjectId: scope === 'any' ? '' : definition.fieldLinkProjectId.toLowerCase(),
            fieldLinkSprintId: scope === 'list' ? definition.fieldLinkSprintId.toLowerCase() : '',
        },
    };
}

/* Whether the writer can open each task is the server's to answer; this checks the shape and the cap. */
function parse(value, definition) {
    if (isBlank(value)) return { value: [] };
    if (!Array.isArray(value) || !value.every(isId)) return { error: NOT_A_LIST };
    const ids = [...new Set(value.map((id) => id.toLowerCase()))];
    const max = maxOf(definition);
    if (ids.length > max) return { error: `This field links at most ${max} ${max === 1 ? 'task' : 'tasks'}.` };
    return { value: ids };
}

/* A task carries no ids. What a viewer is given are the linked tasks they can open, each as { id, key, title, status }. */
const linksOf = (value) => (Array.isArray(value) ? value.filter((link) => link && typeof link === 'object' && isId(link.id)) : []);

const text = (value) => linksOf(value).map((link) => [link.key, link.title].filter(Boolean).join(' ')).filter(Boolean).join(', ');

const sortValue = () => null;

module.exports = {
    type: 'relationship', empty: Object.freeze([]), sortable: false, sideStored: true, DEFAULT_MAX, MAX_RANGE, SCOPES,
    isId, maxOf, scopeOf, linksOf, settings, parse, text, sortValue,
};

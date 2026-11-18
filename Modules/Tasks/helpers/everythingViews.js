const { GROUPS, EverythingRefused } = require('./everythingQuery');

const MAX_VIEWS = 50;
const MAX_NAME = 80;
const MAX_LIST = 100;
const MAX_PROJECTS = 500;
const MAX_TEXT = 100;
const MAX_SEARCH = 200;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const PLAIN_ID = /^[A-Za-z0-9_-]{1,64}$/;

const MODES = Object.freeze(['list', 'board', 'table']);
const DUE_BUCKETS = Object.freeze(['', 'overdue', 'today', 'week', 'later', 'none']);
const SORT_KEYS = Object.freeze(['updatedAt', 'DueDate']);
const SORT_DIRECTIONS = Object.freeze(['asc', 'desc']);
const BODY_KEYS = Object.freeze(['name', 'settings', 'isDefault']);

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));

const listOf = (max, accepts) => (value) => Array.isArray(value) && value.length <= max && value.every(accepts);
const text = (value) => typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT;
const oneOf = (allowed) => (value) => allowed.includes(value);
const flag = (value) => typeof value === 'boolean';

/* What the page keeps for a view: how it looks (mode, group, sort, toggles) and what it filters
 * by. These are the page's own settings, not a request: the endpoint checks the request they
 * become on every read, and the projects named here only ever narrow what the reader can open. */
const SETTING_RULES = Object.freeze({
    mode: oneOf(MODES),
    search: (value) => typeof value === 'string' && value.length <= MAX_SEARCH,
    status: listOf(MAX_LIST, text),
    assignee: listOf(MAX_LIST, (value) => typeof value === 'string' && PLAIN_ID.test(value)),
    priority: listOf(MAX_LIST, text),
    taskType: listOf(MAX_LIST, text),
    projectIds: listOf(MAX_PROJECTS, (value) => typeof value === 'string' && OBJECT_ID.test(value)),
    due: oneOf(DUE_BUCKETS),
    group: oneOf(GROUPS),
    sortBy: oneOf(SORT_KEYS),
    sortDir: oneOf(SORT_DIRECTIONS),
    showSubtasks: flag,
    hideDone: flag,
    includeClosed: flag,
});

const parseViewSettings = (settings) => {
    if (!isPlainObject(settings)) throw new EverythingRefused('settings', 'must be an object');
    const clean = {};
    for (const [key, value] of Object.entries(settings)) {
        const accepts = Object.hasOwn(SETTING_RULES, key) ? SETTING_RULES[key] : null;
        if (!accepts) throw new EverythingRefused(`settings.${key}`, 'is not a known key');
        if (!accepts(value)) throw new EverythingRefused(`settings.${key}`, 'is not a value this setting takes');
        clean[key] = Array.isArray(value) ? [...new Set(value)] : value;
    }
    return clean;
};

const parseViewName = (name) => {
    const trimmed = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
    if (!trimmed || trimmed.length > MAX_NAME) throw new EverythingRefused('name', `must be 1 to ${MAX_NAME} characters`);
    return trimmed;
};

/* The fields a request may set, each checked; `required` names the ones a new view must carry. */
const parseViewBody = (body, required = []) => {
    if (!isPlainObject(body)) throw new EverythingRefused('body', 'must be an object');
    const unknown = Object.keys(body).find((key) => !BODY_KEYS.includes(key));
    if (unknown !== undefined) throw new EverythingRefused(unknown, 'is not a known key');
    const missing = required.find((key) => body[key] === undefined);
    if (missing) throw new EverythingRefused(missing, 'is required');
    const fields = {};
    if (body.name !== undefined) fields.name = parseViewName(body.name);
    if (body.settings !== undefined) fields.settings = parseViewSettings(body.settings);
    if (body.isDefault !== undefined) {
        if (!flag(body.isDefault)) throw new EverythingRefused('isDefault', 'must be true or false');
        fields.isDefault = body.isDefault;
    }
    if (!Object.keys(fields).length) throw new EverythingRefused('body', 'names nothing to change');
    return fields;
};

module.exports = { MAX_VIEWS, MAX_NAME, MODES, parseViewSettings, parseViewName, parseViewBody };

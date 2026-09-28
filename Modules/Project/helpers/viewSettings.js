/* The one shape a saved view's settings take. The API stores only what this returns, and the
 * web app (through the @viewSettings alias) compares the screen against it, so a value the
 * server would drop never shows up as an unsaved change. */

const GROUP_BY = [0, 1, 2, 3];
const DONE_BY = ['all', 'human', 'agent', 'mixed', 'unchecked'];
const SUBTASKS = ['collapsed', 'expanded'];
const FILTER_TYPES = ['array', 'string', 'date', 'object', 'arrayOfObject'];
const COMPARISONS = [':', ':!=', ':>', ':<', ':='];
const CONDITIONS = ['&&', '||'];
const FIELD = /^[A-Za-z][A-Za-z0-9_.]{0,63}$/;
const COLUMN_KEY = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,79}$/;
const ASSIGNEE = /^[A-Za-z0-9_-]{1,64}$/;

const LIMITS = Object.freeze({ search: 200, title: 60, label: 80, value: 200, date: 40, filters: 20, values: 200, columns: 100, assignees: 200 });

const DEFAULT_VIEW_SETTINGS = Object.freeze({
    groupBy: 0,
    me: false,
    assignees: [],
    search: '',
    searchIn: { name: true, key: false, description: false },
    doneBy: 'all',
    subtasks: 'collapsed',
    filters: [],
    sort: null,
    columns: [],
});

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

const scalar = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.slice(0, LIMITS.value);
    return undefined;
};

const dateText = (value) => (value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : text(value, LIMITS.date));

const cleanFilterRow = (row) => {
    if (!isPlainObject(row) || !isPlainObject(row.name) || !isPlainObject(row.comparison)) return null;
    const field = row.name.value;
    const filterOn = row.name.filterOn === undefined ? field : row.name.filterOn;
    if (!FIELD.test(String(field)) || !FIELD.test(String(filterOn))) return null;
    if (!FILTER_TYPES.includes(row.name.type) || !COMPARISONS.includes(row.comparison.value)) return null;
    const values = (Array.isArray(row.values) ? row.values : []).slice(0, LIMITS.values).map(scalar).filter((v) => v !== undefined);
    if (!values.length) return null;
    return {
        name: { value: field, name: text(row.name.name, LIMITS.label), type: row.name.type, filterOn },
        comparison: { value: row.comparison.value, name: text(row.comparison.name, LIMITS.label) },
        values,
        condition: CONDITIONS.includes(row.condition) ? row.condition : '&&',
        date: Array.isArray(row.date) ? row.date.slice(0, 2).map(dateText) : dateText(row.date),
    };
};

const cleanSort = (sort) => {
    if (!isPlainObject(sort) || !FIELD.test(String(sort.field))) return null;
    const dir = Number(sort.dir);
    return dir === 1 || dir === -1 ? { field: sort.field, dir } : null;
};

const cleanColumns = (columns) => {
    const seen = new Set();
    return (Array.isArray(columns) ? columns : []).filter((column) => {
        if (!isPlainObject(column) || !COLUMN_KEY.test(String(column.key)) || seen.has(column.key)) return false;
        seen.add(column.key);
        return true;
    }).slice(0, LIMITS.columns).map((column) => ({ key: column.key, visible: column.visible !== false }));
};

const cleanAssignees = (assignees) => [...new Set((Array.isArray(assignees) ? assignees : [])
    .filter((id) => typeof id === 'string' && ASSIGNEE.test(id)))].slice(0, LIMITS.assignees);

const cleanSearchIn = (searchIn) => {
    const raw = isPlainObject(searchIn) ? searchIn : {};
    const key = raw.key === true;
    const description = raw.description === true;
    return { name: raw.name === false && (key || description) ? false : true, key, description };
};

const cleanViewSettings = (raw) => {
    const settings = isPlainObject(raw) ? raw : {};
    return {
        groupBy: GROUP_BY.includes(settings.groupBy) ? settings.groupBy : DEFAULT_VIEW_SETTINGS.groupBy,
        me: settings.me === true,
        assignees: cleanAssignees(settings.assignees),
        search: text(settings.search, LIMITS.search),
        searchIn: cleanSearchIn(settings.searchIn),
        doneBy: DONE_BY.includes(settings.doneBy) ? settings.doneBy : DEFAULT_VIEW_SETTINGS.doneBy,
        subtasks: SUBTASKS.includes(settings.subtasks) ? settings.subtasks : DEFAULT_VIEW_SETTINGS.subtasks,
        filters: (Array.isArray(settings.filters) ? settings.filters : []).slice(0, LIMITS.filters).map(cleanFilterRow).filter(Boolean),
        sort: cleanSort(settings.sort),
        columns: cleanColumns(settings.columns),
    };
};

const printable = (value) => [...value].filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join('');

const cleanViewTitle = (raw) => printable(text(raw, LIMITS.title * 4)).trim().slice(0, LIMITS.title);

module.exports = { DEFAULT_VIEW_SETTINGS, LIMITS, isPlainObject, cleanViewSettings, cleanViewTitle, cleanFilterRow };

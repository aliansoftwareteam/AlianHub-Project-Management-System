const { PRESETS, isDay, rangeOf, localDay } = require('./reportRange');

const LIST_FIELDS = Object.freeze(['people', 'projects', 'lists', 'status', 'tags', 'types']);
const BILLABLE = Object.freeze(['billable', 'non_billable']);
const QUERY_KEYS = Object.freeze(['range', 'from', 'to', 'billable', ...LIST_FIELDS]);
/* Carried from tab to tab: what each tab reads the same way. */
const SHARED_KEYS = Object.freeze(['range', 'from', 'to', 'people', 'projects']);
const MAX_VALUES = 200;

const listOf = (value) => {
    const raw = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
    return [...new Set(raw.map((item) => String(item == null ? '' : item).trim()).filter(Boolean))].slice(0, MAX_VALUES);
};

const emptyFilters = (preset = 'this_week') => ({ preset, start: '', end: '', people: [], projects: [], lists: [], status: [], tags: [], types: [], billable: '' });

/* The filters a route query asks for, on `today`. Anything malformed falls back to the tab's default preset. */
const readFilters = (query = {}, { defaultPreset = 'this_week', presets = PRESETS, today = localDay() } = {}) => {
    const asked = String(query.range || '');
    const preset = presets.includes(asked) ? asked : defaultPreset;
    const range = rangeOf(preset, today, { start: String(query.from || ''), end: String(query.to || '') });
    const filters = { ...emptyFilters(preset), ...range };
    LIST_FIELDS.forEach((field) => { filters[field] = listOf(query[field]); });
    filters.billable = BILLABLE.includes(String(query.billable)) ? String(query.billable) : '';
    return filters;
};

/* The query for these filters, merged over `base` so keys the tab owns (detailTab, task, ...) stay. Defaults are left out. */
const writeFilters = (filters, base = {}, { defaultPreset = 'this_week' } = {}) => {
    const query = { ...base };
    QUERY_KEYS.forEach((key) => { delete query[key]; });
    if (filters.preset && filters.preset !== defaultPreset) query.range = filters.preset;
    if (filters.preset === 'custom' && isDay(filters.start) && isDay(filters.end)) {
        query.from = filters.start;
        query.to = filters.end;
    }
    LIST_FIELDS.forEach((field) => {
        const values = listOf(filters[field]);
        if (values.length) query[field] = values;
    });
    if (BILLABLE.includes(filters.billable)) query.billable = filters.billable;
    return query;
};

const sharedQuery = (query = {}) => Object.fromEntries(SHARED_KEYS.filter((key) => query[key] != null && query[key] !== '').map((key) => [key, query[key]]));

const activeCount = (filters) => LIST_FIELDS.reduce((n, field) => n + (listOf(filters[field]).length ? 1 : 0), 0) + (filters.billable ? 1 : 0);

/* The body the time routes take: only what narrows, never the range. */
const serverFilters = (filters) => {
    const out = {};
    ['lists', 'status', 'tags'].forEach((field) => {
        const values = listOf(filters[field]);
        if (values.length) out[field] = values;
    });
    if (BILLABLE.includes(filters.billable)) out.billable = filters.billable;
    return out;
};

module.exports = { LIST_FIELDS, QUERY_KEYS, SHARED_KEYS, BILLABLE, emptyFilters, readFilters, writeFilters, sharedQuery, activeCount, serverFilters, listOf };

const { cleanViewSettings } = require('../Project/helpers/viewSettings');

const VIEW_TYPES = Object.freeze(['ProjectListView', 'ProjectKanban', 'TableView', 'Calendar', 'Workload']);
const MAX_TEMPLATES = 100;
const STATUS_FIELD = 'statusKey';
const FIELD_REFERENCE = [/^cf:([a-f0-9]{24})$/i, /^customField\.([a-f0-9]{24})\.fieldValue$/i];

const fieldIdOf = (value) => {
    const text = typeof value === 'string' ? value : '';
    const match = FIELD_REFERENCE.map((pattern) => pattern.exec(text)).find(Boolean);
    return match ? match[1].toLowerCase() : '';
};

/* A saved setup can name custom fields and statuses of the project it came from. Only those parts are
 * rewritten here; every other setting passes through as cleanViewSettings returns it, so a setting added
 * later needs no change in this file. */
const fitSettings = (raw, { fieldIds = new Set(), statusKeys = new Set() } = {}) => {
    const saved = cleanViewSettings(raw);
    const has = new Set([...fieldIds].map((id) => String(id).toLowerCase()));
    const lacks = (reference) => {
        const id = fieldIdOf(reference);
        return Boolean(id) && !has.has(id);
    };
    const leftOut = new Set();
    const keep = (part, kept) => {
        if (!kept) leftOut.add(part);
        return kept;
    };

    const groupBy = keep('group', !lacks(saved.groupBy)) ? saved.groupBy : undefined;
    const sort = keep('sort', !lacks(saved.sort && saved.sort.field)) ? saved.sort : null;
    const filters = saved.filters.map((row) => {
        if (!keep('filters', !lacks(row.name.filterOn))) return null;
        if (row.name.filterOn !== STATUS_FIELD) return row;
        const values = row.values.filter((value) => statusKeys.has(String(value)));
        keep('filters', values.length === row.values.length);
        return values.length ? { ...row, values } : null;
    }).filter(Boolean);
    const columns = Object.fromEntries(Object.entries(saved.columns).map(([list, ids]) => [
        list,
        Array.isArray(ids) ? ids.filter((id) => keep('columns', !lacks(id))) : ids,
    ]));

    return {
        settings: cleanViewSettings({ ...saved, groupBy, sort, filters, columns }),
        leftOut: ['group', 'sort', 'filters', 'columns'].filter((part) => leftOut.has(part)),
    };
};

module.exports = { VIEW_TYPES, MAX_TEMPLATES, fitSettings };

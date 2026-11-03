// The table a report sends to the export routes (Modules/Export): exactly the columns and rows on screen.

const cellOf = (row, column) => {
    const value = typeof column.value === 'function' ? column.value(row) : row[column.key];
    return value === null || value === undefined ? '' : value;
};

/* columns: [{ key, label, value?(row) }]; total: a row object or null. */
const tableOf = ({ columns = [], rows = [], total = null }) => ({
    tableHead: columns.map((column) => String(column.label == null ? '' : column.label)),
    tableRows: rows.map((row) => columns.map((column) => cellOf(row, column))),
    totalRow: total ? columns.map((column) => cellOf(total, column)) : null,
});

const hoursOf = (minutes) => Math.round(((Number(minutes) || 0) / 60) * 100) / 100;

const slug = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'report';

const fileNameOf = (report, range) => [slug(report), range && range.start, range && range.end !== range.start ? range.end : '']
    .filter(Boolean).join('_');

/* Human lines for a PDF header: the range and every filter that narrows, by label. */
const filterLines = (filters, labelOf) => {
    const lines = [];
    if (filters && filters.start) lines.push(labelOf('range', filters.start === filters.end ? filters.start : `${filters.start} – ${filters.end}`));
    ['people', 'projects', 'lists', 'status', 'tags', 'types'].forEach((field) => {
        const values = (filters && filters[field]) || [];
        if (values.length) lines.push(labelOf(field, values));
    });
    if (filters && filters.billable) lines.push(labelOf('billable', filters.billable));
    return lines;
};

module.exports = { tableOf, hoursOf, fileNameOf, filterLines };

// REP-05 — pure tabular-export helpers (CSV string + array-of-arrays for xlsx).
// No I/O. Unit-tested in tests/export-rules.test.js.

// RFC-4180-style escaping: wrap in quotes when the value has a comma, quote, CR
// or LF; double any embedded quotes.
const csvEscape = (v) => {
    const s = (v === null || v === undefined) ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// head: string[], rows: any[][], totalRow?: any[] → CSV text.
const toCsv = (head = [], rows = [], totalRow = null) => {
    const lines = [];
    if (Array.isArray(head) && head.length) lines.push(head.map(csvEscape).join(','));
    (rows || []).forEach((r) => lines.push((Array.isArray(r) ? r : []).map(csvEscape).join(',')));
    if (Array.isArray(totalRow) && totalRow.length) lines.push(totalRow.map(csvEscape).join(','));
    return lines.join('\r\n');
};

// Array-of-arrays for xlsx (header + rows + optional total), null → ''.
const toAoa = (head = [], rows = [], totalRow = null) => {
    const norm = (r) => (Array.isArray(r) ? r : []).map((c) => (c === null || c === undefined ? '' : c));
    const aoa = [];
    if (Array.isArray(head) && head.length) aoa.push(norm(head));
    (rows || []).forEach((r) => aoa.push(norm(r)));
    if (Array.isArray(totalRow) && totalRow.length) aoa.push(norm(totalRow));
    return aoa;
};

const sanitizeFilename = (name) => String(name || 'export').replace(/[^a-z0-9-_]+/gi, '_').slice(0, 60) || 'export';

module.exports = { csvEscape, toCsv, toAoa, sanitizeFilename };

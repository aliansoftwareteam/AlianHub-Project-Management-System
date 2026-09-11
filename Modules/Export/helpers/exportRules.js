const { neutraliseFormula } = require('../../../utils/csvSafe');

const csvEscape = (v) => {
    const s = (v === null || v === undefined) ? '' : String(neutraliseFormula(v));
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const toCsv = (head = [], rows = [], totalRow = null) => {
    const lines = [];
    if (Array.isArray(head) && head.length) lines.push(head.map(csvEscape).join(','));
    (rows || []).forEach((r) => lines.push((Array.isArray(r) ? r : []).map(csvEscape).join(',')));
    if (Array.isArray(totalRow) && totalRow.length) lines.push(totalRow.map(csvEscape).join(','));
    return lines.join('\r\n');
};

const toAoa = (head = [], rows = [], totalRow = null) => {
    const norm = (r) => (Array.isArray(r) ? r : []).map((c) => (c === null || c === undefined ? '' : neutraliseFormula(c)));
    const aoa = [];
    if (Array.isArray(head) && head.length) aoa.push(norm(head));
    (rows || []).forEach((r) => aoa.push(norm(r)));
    if (Array.isArray(totalRow) && totalRow.length) aoa.push(norm(totalRow));
    return aoa;
};

const sanitizeFilename = (name) => String(name || 'export').replace(/[^a-z0-9-_]+/gi, '_').slice(0, 60) || 'export';

module.exports = { csvEscape, toCsv, toAoa, sanitizeFilename };

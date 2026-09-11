/* A spreadsheet runs a cell that starts with one of these as a formula; plain numbers stay numbers. */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;

const csvCell = (value) => {
    if (value === null || value === undefined) return '';
    let text = String(value);
    if (typeof value !== 'number' && FORMULA_TRIGGER.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const csvRow = (values) => values.map(csvCell).join(',');

module.exports = { csvCell, csvRow };

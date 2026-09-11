const { neutraliseFormula } = require('./csvSafe');

const csvCell = (value) => {
    if (value === null || value === undefined) return '';
    const text = String(neutraliseFormula(value));
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const csvRow = (values) => values.map(csvCell).join(',');

module.exports = { csvCell, csvRow };

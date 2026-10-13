const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

/* The rows the browser hands the importer: the export read with the same library and options the dialog uses. */
module.exports = () => {
    const workbook = XLSX.read(fs.readFileSync(path.join(__dirname, 'clickup-export.csv')), { type: 'buffer', raw: true });
    return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '', raw: false });
};

/* An invented ClickUp workspace as one CSV: two lists, one of them in a folder, 40 rows. Nothing in it came from a ClickUp
 * account; the columns and cell shapes are the ones the importer reads. ClickUp splits them over two exports (a view export
 * carries the "<field> (<type>)" columns, the workspace export carries Comments, Checklists and Attachments), and one file
 * holds both here so every mapping has a row. `rows()` answers what the browser hands the server: the file read with the
 * library and options of frontend/src/components/organisms/WorkspaceImport/readSheet.js. */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const FILE = path.join(__dirname, 'clickup-export.csv');

const rows = () => {
    const workbook = XLSX.read(fs.readFileSync(FILE), { type: 'buffer', raw: true, codepage: 65001 });
    return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '', raw: false });
};

module.exports = { FILE, rows };

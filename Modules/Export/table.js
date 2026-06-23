// REP-05 — tabular CSV / Excel export. Same "client sends the data it displays"
// pattern as pdf.js (S4-04): the request carries the table (head + rows + total),
// so any report can export by passing its on-screen dataset — no server-side
// report re-computation, and the file always matches the screen.
const logger = require('../../Config/loggerConfig');
const { toCsv, toAoa, sanitizeFilename } = require('./helpers/exportRules');

// xlsx is lazy-loaded so a missing install never breaks startup — only this
// endpoint would error (matches pdf.js's lazy pdfmake).
let _xlsx = null;
const getXlsx = () => { if (!_xlsx) _xlsx = require('xlsx'); return _xlsx; };

// POST /api/v1/export/csv  body: { filename?, tableHead?: string[], tableRows?: any[][], totalRow?: any[] }
exports.exportCsv = (req, res) => {
    try {
        const { filename, tableHead = [], tableRows = [], totalRow = null } = req.body || {};
        const csv = toCsv(tableHead, tableRows, totalRow);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(filename)}.csv"`);
        // UTF-8 BOM so Excel opens accented/non-ASCII text correctly.
        return res.send('﻿' + csv);
    } catch (e) {
        logger.error(`exportCsv: ${e.message}`);
        if (!res.headersSent) res.status(500).send({ status: false, statusText: e.message });
    }
};

// POST /api/v1/export/xlsx  same body → an .xlsx workbook.
exports.exportXlsx = (req, res) => {
    try {
        const { filename, tableHead = [], tableRows = [], totalRow = null, sheetName } = req.body || {};
        const XLSX = getXlsx();
        const ws = XLSX.utils.aoa_to_sheet(toAoa(tableHead, tableRows, totalRow));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, (sanitizeFilename(sheetName || 'Report').slice(0, 31)) || 'Report');
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(filename)}.xlsx"`);
        return res.send(buf);
    } catch (e) {
        logger.error(`exportXlsx: ${e.message}`);
        if (!res.headersSent) res.status(500).send({ status: false, statusText: e.message });
    }
};

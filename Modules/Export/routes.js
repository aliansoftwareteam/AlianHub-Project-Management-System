const pdf = require('./pdf');
const table = require('./table');

exports.init = (app) => {
    // Client-shareable PDF export (S4-04). Auth/companyId via global middleware.
    app.post('/api/v1/export/pdf', pdf.exportPdf);
    // Tabular CSV / Excel export (REP-05) — same client-sends-the-data pattern.
    app.post('/api/v1/export/csv', table.exportCsv);
    app.post('/api/v1/export/xlsx', table.exportXlsx);
};

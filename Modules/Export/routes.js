const pdf = require('./pdf');

exports.init = (app) => {
    // Client-shareable PDF export (S4-04). Auth/companyId via global middleware.
    app.post('/api/v1/export/pdf', pdf.exportPdf);
};

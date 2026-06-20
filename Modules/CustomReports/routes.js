const ctrl = require('./controller');

exports.init = (app) => {
    // JWT + companyId enforced in setMiddleware (prefix /api/v1/reports/custom).
    app.post('/api/v1/reports/custom/run', ctrl.runReport);   // live preview (no save)
    app.post('/api/v1/reports/custom', ctrl.createReport);
    app.get('/api/v1/reports/custom', ctrl.listReports);
    app.get('/api/v1/reports/custom/:id/run', ctrl.getReportResult); // load + execute (reload)
    app.put('/api/v1/reports/custom/:id', ctrl.updateReport);
    app.delete('/api/v1/reports/custom/:id', ctrl.deleteReport);
};

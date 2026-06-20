const ctrl = require('./controller');

exports.init = (app) => {
    // JWT + companyId enforced in setMiddleware (prefix /api/v1/reports/custom).
    app.get('/api/v1/reports/custom/templates', ctrl.listTemplates);            // REP-07 built-in templates
    app.post('/api/v1/reports/custom/run', ctrl.runReport);                     // live preview (no save)
    app.post('/api/v1/reports/custom/from-template', ctrl.createFromTemplate);  // REP-07 save from a template
    app.post('/api/v1/reports/custom', ctrl.createReport);
    app.get('/api/v1/reports/custom', ctrl.listReports);
    app.get('/api/v1/reports/custom/:id/run', ctrl.getReportResult);            // load + execute (reload)
    app.post('/api/v1/reports/custom/:id/duplicate', ctrl.duplicateReport);     // REP-07 clone a saved report
    app.put('/api/v1/reports/custom/:id', ctrl.updateReport);
    app.delete('/api/v1/reports/custom/:id', ctrl.deleteReport);
};

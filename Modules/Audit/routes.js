const ctrl = require('./controller');

exports.init = (app) => {
    app.get('/api/v1/audit-logs', ctrl.listAuditLogs);
    // Before /:id/undo so "export" is never read as an id.
    app.get('/api/v1/audit-logs/export', ctrl.exportAuditCsv);
    app.post('/api/v1/audit-logs/:id/undo', ctrl.undoAuditLog);
}

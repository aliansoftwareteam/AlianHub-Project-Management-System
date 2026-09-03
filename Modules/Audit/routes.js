const ctrl = require('./controller');

exports.init = (app) => {
    app.get('/api/v1/audit-logs', ctrl.listAuditLogs);
    app.post('/api/v1/audit-logs/:id/undo', ctrl.undoAuditLog);
}

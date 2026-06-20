const ctrl = require('./controller');

exports.init = (app) => {
    app.get('/api/v1/audit-logs', ctrl.listAuditLogs);
}

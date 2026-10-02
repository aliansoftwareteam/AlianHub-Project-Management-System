const ctrl = require('./controller');
const { setByPerson } = require('../Agents/personDecides');

exports.init = (app) => {
    app.get('/api/v1/audit-logs', ctrl.listAuditLogs);
    // Before /:id/undo so "export" is never read as an id.
    app.get('/api/v1/audit-logs/export', ctrl.exportAuditCsv);
    app.post('/api/v1/audit-logs/:id/undo', setByPerson('agent.change.undo'), ctrl.undoAuditLog);
}

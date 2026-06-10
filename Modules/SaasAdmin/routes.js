const instanceAdmin = require('./instanceAdmin');

exports.init = (app) => {
    // Instance-admin endpoints — active only when INSTANCE_ADMIN_KEY is set;
    // every request must carry the matching `adminkey` header.
    app.get('/api/v2/instance/stats', instanceAdmin.getInstanceStats);
    app.get('/api/v2/instance/companies', instanceAdmin.listInstanceCompanies);
    app.get('/api/v2/instance/audit-export', instanceAdmin.exportAuditLog);
}

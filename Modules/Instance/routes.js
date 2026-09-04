const ctrl = require('./controller');
const { requireInstanceAdmin } = require('./guard');

exports.init = (app) => {
    app.get('/api/v2/instance/public-config', ctrl.publicConfig);

    const admin = '/api/v2/instance';
    app.use(admin, (req, res, next) => (req.path === '/public-config' ? next() : requireInstanceAdmin(req, res, next)));
    app.get(`${admin}/access`, ctrl.access);
    app.get(`${admin}/settings`, ctrl.getSettings);
    app.put(`${admin}/settings`, ctrl.putSettings);
    app.post(`${admin}/settings/test`, ctrl.testSettings);
    app.get(`${admin}/health`, ctrl.health);
    app.post(`${admin}/maintenance`, ctrl.setMaintenance);
    app.get(`${admin}/upgrade`, ctrl.upgrade);
    app.post(`${admin}/migrations/run`, ctrl.runMigrations);
    app.get(`${admin}/logs`, ctrl.tailLog);
    app.get(`${admin}/logs/files`, ctrl.listLogs);
    app.get(`${admin}/logs/download`, ctrl.downloadLog);
    app.get(`${admin}/backups`, ctrl.listBackups);
    app.post(`${admin}/backups`, ctrl.createBackup);
    app.get(`${admin}/backups/:name/manifest`, ctrl.backupManifest);
    app.get(`${admin}/backups/:name/download`, ctrl.downloadBackup);
    app.post(`${admin}/backups/:name/restore`, ctrl.restoreBackup);
    app.delete(`${admin}/backups/:name`, ctrl.deleteBackup);
    app.get(`${admin}/stats`, ctrl.stats);
    app.get(`${admin}/companies`, ctrl.companies);
    app.get(`${admin}/audit-export`, ctrl.auditExport);
};

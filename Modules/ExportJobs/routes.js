const ctrl = require('./controller');
const { agentsRefused } = require('../Agents/guard');

exports.init = (app) => {
    app.get('/api/v2/exports/:id/download', ctrl.downloadExport);
    app.get('/api/v2/exports', ctrl.listExports);
    app.post('/api/v2/exports/workspace', agentsRefused('export.workspace'), ctrl.createWorkspaceExport);
    app.post('/api/v2/exports', ctrl.createExport);
}

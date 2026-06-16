const ctrl = require('./controller');

exports.init = (app) => {
    app.get('/api/v2/exports/:id/download', ctrl.downloadExport);
    app.get('/api/v2/exports', ctrl.listExports);
    app.post('/api/v2/exports', ctrl.createExport);
}

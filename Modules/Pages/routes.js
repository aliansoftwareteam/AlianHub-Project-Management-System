const ctrl = require('./controller');

exports.init = (app) => {
    app.get('/api/v2/pages/:id/versions', ctrl.listVersions);
    app.post('/api/v2/pages/:id/restore', ctrl.restoreVersion);
    app.get('/api/v2/pages/:id', ctrl.getPage);
    app.put('/api/v2/pages/:id', ctrl.updatePage);
    app.delete('/api/v2/pages/:id', ctrl.deletePage);
    app.get('/api/v2/pages', ctrl.listPages);
    app.post('/api/v2/pages', ctrl.createPage);
}

const ctrl = require('./controller');

exports.init = (app) => {
    app.post('/api/v2/imports/jira', ctrl.importFromJira);
    app.get('/api/v2/imports', ctrl.listImports);
}

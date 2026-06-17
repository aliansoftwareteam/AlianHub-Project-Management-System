const ctrl = require('./controller');

exports.init = (app) => {
    app.post('/api/v2/imports/jira', ctrl.importFromJira);
    app.post('/api/v2/imports/csv', ctrl.importFromCsv);
    app.post('/api/v2/imports/trello', ctrl.importFromTrello);
    app.get('/api/v2/imports', ctrl.listImports);
}

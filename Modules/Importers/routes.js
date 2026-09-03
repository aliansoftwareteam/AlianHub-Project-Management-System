const ctrl = require('./controller');

exports.init = (app) => {
    app.post('/api/v2/imports/jira', ctrl.importFromJira);
    app.post('/api/v2/imports/csv', ctrl.importFromCsv);
    app.post('/api/v2/imports/csv/preview', ctrl.previewCsv);
    app.post('/api/v2/imports/trello', ctrl.importFromTrello);
    app.post('/api/v2/imports/asana', ctrl.importFromAsana);
    app.post('/api/v2/imports/monday', ctrl.importFromMonday);
    app.get('/api/v2/imports', ctrl.listImports);
}

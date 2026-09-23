const ctrl = require('./controller');
const { requireTaskWritePermission } = require('../../Config/permissionGuard');
const { TASK_WRITE_ROUTES } = require('../../Config/taskWritePermissions');

const createsTasks = requireTaskWritePermission(TASK_WRITE_ROUTES['POST /api/v2/tasks'].entry);

exports.init = (app) => {
    app.post('/api/v2/imports/jira', createsTasks, ctrl.importFromJira);
    app.post('/api/v2/imports/csv', createsTasks, ctrl.importFromCsv);
    app.post('/api/v2/imports/csv/preview', ctrl.previewCsv);
    app.post('/api/v2/imports/trello', createsTasks, ctrl.importFromTrello);
    app.post('/api/v2/imports/asana', createsTasks, ctrl.importFromAsana);
    app.post('/api/v2/imports/monday', createsTasks, ctrl.importFromMonday);
    app.get('/api/v2/imports', ctrl.listImports);
}

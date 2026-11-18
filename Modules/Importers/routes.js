const ctrl = require('./controller');
const { requirePermission, requireTaskWritePermission } = require('../../Config/permissionGuard');
const { TASK_WRITE_ROUTES } = require('../../Config/taskWritePermissions');
const { agentsRefused } = require('../Agents/guard');

const createsTasks = requireTaskWritePermission(TASK_WRITE_ROUTES['POST /api/v2/tasks'].entry);
const byPeople = agentsRefused('tasks.import');

exports.init = (app) => {
    app.post('/api/v2/imports/jira', byPeople, createsTasks, ctrl.importFromJira);
    app.post('/api/v2/imports/csv', byPeople, createsTasks, ctrl.importFromCsv);
    app.post('/api/v2/imports/csv/preview', ctrl.previewCsv);
    app.post('/api/v2/imports/trello', byPeople, createsTasks, ctrl.importFromTrello);
    app.post('/api/v2/imports/asana', byPeople, createsTasks, ctrl.importFromAsana);
    app.post('/api/v2/imports/monday', byPeople, createsTasks, ctrl.importFromMonday);
    app.post('/api/v2/imports/clickup/preview', ctrl.previewClickUp);
    app.post('/api/v2/imports/clickup/project', byPeople, requirePermission('project.project_create'), createsTasks, ctrl.importClickUpAsProject);
    app.post('/api/v2/imports/clickup', byPeople, createsTasks, ctrl.importFromClickUp);
    app.post('/api/v2/imports/:id/undo', byPeople, ctrl.undoImport);
    app.get('/api/v2/imports', ctrl.listImports);
}

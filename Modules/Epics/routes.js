const ctrl = require('./controller');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { READ, requireProjectAccess, projectIdsFrom } = require('../../Config/projectAccess');

const ofEpic = projectIdsFrom({ records: [[SCHEMA_TYPE.EPICS, (req) => req.params.id]] });
const ofAssignment = projectIdsFrom({ records: [[SCHEMA_TYPE.TASKS, (req) => req.body && req.body.taskId], [SCHEMA_TYPE.EPICS, (req) => req.body && req.body.epicId]] });

// The permission catalogue has no epic key until task 031, so an epic write needs what creating a
// task needs: a role left read-only in the project (a guest, by default) does not change its epics.
const TASK_CREATE = 'task.task_create';
const changesEpics = (projectIds) => requireProjectAccess({ projectIds, permissions: () => [TASK_CREATE], passMissing: () => true });

exports.init = (app) => {
    app.post('/api/v2/epics/assign', changesEpics(ofAssignment), ctrl.assignTask);
    app.post('/api/v2/epics/:id/recount', changesEpics(ofEpic), ctrl.recountEpic);
    app.post('/api/v2/epics', changesEpics((req) => req.body && req.body.projectId), ctrl.createEpic);
    app.get('/api/v2/epics', requireProjectAccess({ mode: READ, projectIds: (req) => req.query && req.query.projectId }), ctrl.listEpics);
    app.put('/api/v2/epics/:id', changesEpics(ofEpic), ctrl.updateEpic);
    app.delete('/api/v2/epics/:id', changesEpics(ofEpic), ctrl.deleteEpic);
}

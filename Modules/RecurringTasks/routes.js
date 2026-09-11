const controller = require('./controller');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { READ, requireProjectAccess, projectIdsFrom } = require('../../Config/projectAccess');

const CREATES_TASKS = ['task.task_create'];

const ofDefinition = projectIdsFrom({ records: [[SCHEMA_TYPE.RECURRING_TASKS, (req) => req.params.id]] });
const ofNewDefinition = projectIdsFrom({
    records: [[SCHEMA_TYPE.SPRINTS, (req) => req.body && [req.body.sprintId, req.body.sprintArray]]],
    direct: (req) => req.body && req.body.projectData,
});

const changesDefinitions = (projectIds, permissions = []) => requireProjectAccess({ projectIds, permissions: () => permissions, passMissing: () => true });

exports.init = (app) => {
    app.post('/api/v1/recurring-tasks', changesDefinitions(ofNewDefinition, CREATES_TASKS), controller.createDefinition);
    app.get('/api/v1/recurring-tasks/project/:pid', requireProjectAccess({ mode: READ, projectIds: (req) => req.params.pid }), controller.listByProject);
    app.patch('/api/v1/recurring-tasks/:id', changesDefinitions(ofDefinition), controller.updateDefinition);
    app.delete('/api/v1/recurring-tasks/:id', changesDefinitions(ofDefinition), controller.deleteDefinition);
    app.post('/api/v1/recurring-tasks/:id/run-now', changesDefinitions(ofDefinition, CREATES_TASKS), controller.runNow);
    // Process every due definition for the caller's company (manual; cron does this in prod).
    app.post('/api/v1/recurring-tasks/run-due', controller.runDueForCompany);
    logger.info('RecurringTasks routes initialised');
};

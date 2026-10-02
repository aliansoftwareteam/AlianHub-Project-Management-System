const controller = require('./controller');
const taskRule = require('./taskRule');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { requireCompanyAdmin } = require('../../Config/permissionGuard');
const { READ, requireProjectAccess, projectIdsFrom } = require('../../Config/projectAccess');
const { requireSprintAccess } = require('../Sprints/helpers/sprintVisibility');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const mongoose = require('mongoose');

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const CREATES_TASKS = ['task.task_create'];
// A repeat is part of the task's dates, and every occurrence is a new task.
const REPEATS_TASK = ['task.task_due_date', 'task.task_create'];

const ofTask = projectIdsFrom({ records: [[SCHEMA_TYPE.TASKS, (req) => req.params.taskId]] });
const ofDefinition = projectIdsFrom({ records: [[SCHEMA_TYPE.RECURRING_TASKS, (req) => req.params.id]] });
const ofNewDefinition = projectIdsFrom({
    records: [[SCHEMA_TYPE.SPRINTS, (req) => req.body && [req.body.sprintId, req.body.sprintArray]]],
    direct: (req) => req.body && req.body.projectData,
});

const changesDefinitions = (projectIds, permissions = []) => requireProjectAccess({ projectIds, permissions: () => permissions, passMissing: () => true });

/* A repeat set in a private list is changed and run by a person who is on that list. */
const onItsList = requireSprintAccess((req) => req.definitionListId);
const namesItsList = async (req, res, next) => {
    try {
        const id = String(req.params.id || '');
        const definition = OBJECT_ID.test(id) && OBJECT_ID.test(String(req.headers['companyid'] || ''))
            ? await MongoDbCrudOpration(String(req.headers['companyid']), { type: SCHEMA_TYPE.RECURRING_TASKS, data: [{ _id: new mongoose.Types.ObjectId(id) }, { sprintId: 1 }] }, 'findOne')
            : null;
        req.definitionListId = definition && definition.sprintId ? String(definition.sprintId) : '';
        return onItsList(req, res, next);
    } catch (error) {
        logger.error(`[recurringTasks] list check failed: ${error.message}`);
        return res.status(403).json({ status: false, statusText: 'Permission check failed.', error: 'Forbidden' });
    }
};
const { agentsRefused } = require('../Agents/guard');

/* A repeat keeps making tasks with no person there, so a person sets it. */
const repeatsSetByPeople = agentsRefused('recurring.manage');

exports.init = (app) => {
    app.post('/api/v1/recurring-tasks', repeatsSetByPeople, changesDefinitions(ofNewDefinition, CREATES_TASKS), controller.createDefinition);
    app.get('/api/v1/recurring-tasks/project/:pid', requireProjectAccess({ mode: READ, projectIds: (req) => req.params.pid }), controller.listByProject);
    app.get('/api/v1/recurring-tasks/task/:taskId', requireProjectAccess({ mode: READ, projectIds: ofTask }), taskRule.getForTask);
    app.put('/api/v1/recurring-tasks/task/:taskId', repeatsSetByPeople, requireProjectAccess({ projectIds: ofTask, permissions: () => REPEATS_TASK }), taskRule.saveForTask);
    app.delete('/api/v1/recurring-tasks/task/:taskId', requireProjectAccess({ projectIds: ofTask, permissions: () => ['task.task_due_date'] }), taskRule.removeForTask);
    app.patch('/api/v1/recurring-tasks/:id', repeatsSetByPeople, changesDefinitions(ofDefinition), namesItsList, controller.updateDefinition);
    app.delete('/api/v1/recurring-tasks/:id', changesDefinitions(ofDefinition), namesItsList, controller.deleteDefinition);
    app.post('/api/v1/recurring-tasks/:id/run-now', repeatsSetByPeople, changesDefinitions(ofDefinition, CREATES_TASKS), namesItsList, controller.runNow);
    // Company-wide task creation has no one project to judge, so it is an owner/admin act for every caller.
    app.post('/api/v1/recurring-tasks/run-due', repeatsSetByPeople, requireCompanyAdmin(), controller.runDueForCompany);
    logger.info('RecurringTasks routes initialised');
};

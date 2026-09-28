const controller = require('./controller');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { READ, DETAILS, requireProjectAccess, projectIdsFrom } = require('../../Config/projectAccess');

const ofProject = (req) => req.params.projectId;
const ofTask = projectIdsFrom({ records: [[SCHEMA_TYPE.TASKS, (req) => req.params.taskId]] });

const readsProject = requireProjectAccess({ mode: READ, projectIds: ofProject });
const editsRules = requireProjectAccess({ projectIds: ofProject, permissions: () => [DETAILS] });
const readsTask = requireProjectAccess({ mode: READ, projectIds: ofTask });
const assignsTask = requireProjectAccess({ projectIds: ofTask, permissions: () => ['task.task_assignee'] });

exports.init = (app) => {
    app.get('/api/v2/assignment-rules/project/:projectId', readsProject, controller.getProjectRules);
    app.put('/api/v2/assignment-rules/project/:projectId', editsRules, controller.saveProjectRules);
    app.post('/api/v2/assignment-rules/project/:projectId/draft', editsRules, controller.draftProjectRules);
    app.get('/api/v2/assignment-rules/task/:taskId', readsTask, controller.getTaskDecision);
    app.post('/api/v2/assignment-rules/task/:taskId/decisions/:decisionId/accept', assignsTask, controller.actOnDecision('accept'));
    app.post('/api/v2/assignment-rules/task/:taskId/decisions/:decisionId/dismiss', assignsTask, controller.actOnDecision('dismiss'));
    app.post('/api/v2/assignment-rules/task/:taskId/decisions/:decisionId/undo', assignsTask, controller.actOnDecision('undo'));
    logger.info('AssignmentRules routes initialised');
};

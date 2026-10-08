const controller = require('./controller');
const dispatcher = require('./dispatcher/controller');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { READ, DETAILS, requireProjectAccess, projectIdsFrom } = require('../../Config/projectAccess');
const { decidedByPerson } = require('../Agents/personDecides');

const ofProject = (req) => req.params.projectId;
const ofTask = projectIdsFrom({ records: [[SCHEMA_TYPE.TASKS, (req) => req.params.taskId]] });

const readsProject = requireProjectAccess({ mode: READ, projectIds: ofProject });
const editsRules = requireProjectAccess({ projectIds: ofProject, permissions: () => [DETAILS] });
const readsTask = requireProjectAccess({ mode: READ, projectIds: ofTask });
const assignsTask = requireProjectAccess({ projectIds: ofTask, permissions: () => ['task.task_assignee'] });
const byPerson = (action) => decidedByPerson(`assignment.suggestion.${action}`);
const { agentsRefused } = require('../Agents/guard');

exports.init = (app) => {
    app.get('/api/v2/assignment-rules/project/:projectId', readsProject, controller.getProjectRules);
    app.put('/api/v2/assignment-rules/project/:projectId', agentsRefused('project.settings'), editsRules, controller.saveProjectRules);
    app.post('/api/v2/assignment-rules/project/:projectId/draft', agentsRefused('ai.spend'), editsRules, controller.draftProjectRules);
    app.get('/api/v2/assignment-rules/task/:taskId', readsTask, controller.getTaskDecision);
    app.post('/api/v2/assignment-rules/task/:taskId/decisions/:decisionId/accept', byPerson('accept'), assignsTask, controller.actOnDecision('accept'));
    app.post('/api/v2/assignment-rules/task/:taskId/decisions/:decisionId/dismiss', byPerson('dismiss'), assignsTask, controller.actOnDecision('dismiss'));
    app.post('/api/v2/assignment-rules/task/:taskId/decisions/:decisionId/undo', byPerson('undo'), assignsTask, controller.actOnDecision('undo'));

    app.get('/api/v2/assignment-rules/dispatcher/project/:projectId', readsProject, dispatcher.getSettings);
    app.put('/api/v2/assignment-rules/dispatcher/project/:projectId', dispatcher.whenOn, agentsRefused('project.settings'), editsRules, dispatcher.saveSettings);
    app.post('/api/v2/assignment-rules/dispatcher/project/:projectId/rules', dispatcher.whenOn, agentsRefused('project.settings'), editsRules, dispatcher.addRule);
    app.get('/api/v2/assignment-rules/dispatcher/project/:projectId/needs-routing', readsProject, dispatcher.getNeedsRouting);
    app.get('/api/v2/assignment-rules/dispatcher/task/:taskId', readsTask, dispatcher.getTaskDecision);
    app.post('/api/v2/assignment-rules/dispatcher/task/:taskId/decisions/:decisionId/accept', dispatcher.whenOn, decidedByPerson('dispatcher.suggestion.accept'), assignsTask, dispatcher.actOnDecision('accept'));
    app.post('/api/v2/assignment-rules/dispatcher/task/:taskId/decisions/:decisionId/dismiss', dispatcher.whenOn, decidedByPerson('dispatcher.suggestion.dismiss'), assignsTask, dispatcher.actOnDecision('dismiss'));
    app.post('/api/v2/assignment-rules/dispatcher/task/:taskId/decisions/:decisionId/route', dispatcher.whenOn, decidedByPerson('dispatcher.suggestion.route'), assignsTask, dispatcher.actOnDecision('route'));
    logger.info('AssignmentRules routes initialised');
};

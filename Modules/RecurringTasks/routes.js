const controller = require('./controller');
const logger = require('../../Config/loggerConfig');

exports.init = (app) => {
    // Create a recurring task definition for a project.
    app.post('/api/v1/recurring-tasks', controller.createDefinition);
    // List a project's recurring definitions.
    app.get('/api/v1/recurring-tasks/project/:pid', controller.listByProject);
    // Edit / pause / resume (PATCH { enabled, freq, ... }).
    app.patch('/api/v1/recurring-tasks/:id', controller.updateDefinition);
    // Soft-delete a definition.
    app.delete('/api/v1/recurring-tasks/:id', controller.deleteDefinition);
    // Instantiate one task immediately (manual / testing).
    app.post('/api/v1/recurring-tasks/:id/run-now', controller.runNow);
    // Process every due definition for the caller's company (manual; cron does this in prod).
    app.post('/api/v1/recurring-tasks/run-due', controller.runDueForCompany);
    logger.info('RecurringTasks routes initialised');
};

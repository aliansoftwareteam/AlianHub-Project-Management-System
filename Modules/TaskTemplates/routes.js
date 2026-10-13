const ctrl = require('./controller');
const { agentsRefused } = require('../Agents/guard');

exports.init = (app) => {
    app.get('/api/v2/task-templates', ctrl.listTemplates);
    app.post('/api/v2/task-templates', agentsRefused('template.save'), ctrl.saveTemplate);
    app.put('/api/v2/task-templates/default', agentsRefused('project.settings'), ctrl.setDefaultTemplate);
    app.post('/api/v2/task-templates/:id/apply', agentsRefused('template.apply'), ctrl.applyTemplate);
    app.patch('/api/v2/task-templates/:id', agentsRefused('template.update'), ctrl.renameTemplate);
    app.delete('/api/v2/task-templates/:id', ctrl.deleteTemplate);
};

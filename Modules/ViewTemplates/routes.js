const ctrl = require('./controller');
const { agentsRefused } = require('../Agents/guard');

exports.init = (app) => {
    app.get('/api/v2/view-templates', ctrl.listTemplates);
    app.post('/api/v2/view-templates', agentsRefused('template.save'), ctrl.saveTemplate);
    app.patch('/api/v2/view-templates/:id', agentsRefused('template.update'), ctrl.renameTemplate);
    app.delete('/api/v2/view-templates/:id', ctrl.deleteTemplate);
};

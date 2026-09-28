const ctrl = require('./controller');

exports.init = (app) => {
    app.get('/api/v2/task-templates', ctrl.listTemplates);
    app.post('/api/v2/task-templates', ctrl.saveTemplate);
    app.put('/api/v2/task-templates/default', ctrl.setDefaultTemplate);
    app.post('/api/v2/task-templates/:id/apply', ctrl.applyTemplate);
    app.patch('/api/v2/task-templates/:id', ctrl.renameTemplate);
    app.delete('/api/v2/task-templates/:id', ctrl.deleteTemplate);
};

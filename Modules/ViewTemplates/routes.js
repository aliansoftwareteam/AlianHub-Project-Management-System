const ctrl = require('./controller');

exports.init = (app) => {
    app.get('/api/v2/view-templates', ctrl.listTemplates);
    app.post('/api/v2/view-templates', ctrl.saveTemplate);
    app.patch('/api/v2/view-templates/:id', ctrl.renameTemplate);
    app.delete('/api/v2/view-templates/:id', ctrl.deleteTemplate);
};

const ctrl = require('./controller');

exports.init = (app) => {
    app.get('/api/v2/pages/ai-status', ctrl.aiStatus);
    app.post('/api/v2/pages/ai', ctrl.composeWithAi);
    app.post('/api/v2/pages/ask-workspace', ctrl.askWorkspace);
    app.get('/api/v2/pages/:id', ctrl.getPage);
    app.put('/api/v2/pages/:id', ctrl.updatePage);
    app.delete('/api/v2/pages/:id', ctrl.deletePage);
    app.get('/api/v2/pages', ctrl.listPages);
    app.post('/api/v2/pages', ctrl.createPage);
}

const ctrl = require('./controller');

exports.init = (app) => {
    app.get('/api/v2/stickies', ctrl.listStickies);
    app.post('/api/v2/stickies', ctrl.createSticky);
    app.put('/api/v2/stickies/reorder', ctrl.reorderStickies);
    app.put('/api/v2/stickies/:id', ctrl.updateSticky);
    app.delete('/api/v2/stickies/:id', ctrl.deleteSticky);
}

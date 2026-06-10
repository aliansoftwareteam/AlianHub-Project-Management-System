const ctrl = require('./controller');

exports.init = (app) => {
    app.post('/api/v2/epics/assign', ctrl.assignTask);
    app.post('/api/v2/epics/:id/recount', ctrl.recountEpic);
    app.post('/api/v2/epics', ctrl.createEpic);
    app.get('/api/v2/epics', ctrl.listEpics);
    app.put('/api/v2/epics/:id', ctrl.updateEpic);
    app.delete('/api/v2/epics/:id', ctrl.deleteEpic);
}

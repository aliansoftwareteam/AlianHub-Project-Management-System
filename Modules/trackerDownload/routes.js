const ctrl = require('./controller');

exports.init = (app) => {
    app.delete('/api/v1/tracker/delete/:id', ctrl.deleteTracker);
    app.post('/api/v1/tracker/create', ctrl.saveTracker);
    app.put('/api/v1/tracker/update', ctrl.updateTracker);
    app.get('/api/v1/tracker', ctrl.getTracker);
};
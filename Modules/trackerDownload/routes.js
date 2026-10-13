const { requireInstanceAdmin } = require('../Instance/guard');
const ctrl = require('./controller');

exports.init = (app) => {
    app.delete('/api/v1/tracker/delete/:id', requireInstanceAdmin, ctrl.deleteTracker);
    app.post('/api/v1/tracker/create', requireInstanceAdmin, ctrl.saveTracker);
    app.put('/api/v1/tracker/update', requireInstanceAdmin, ctrl.updateTracker);
    app.get('/api/v1/tracker', ctrl.getTracker);
};
const ctrl = require('./controller');

exports.init = (app) => {
    app.post('/api/v2/recent-visits', ctrl.recordVisit);
    app.get('/api/v2/recent-visits', ctrl.listVisits);
}

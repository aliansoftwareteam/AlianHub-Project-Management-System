const ctrl = require('./controller');
const renderer = require('./publicRenderer');

exports.init = (app) => {
    // Authenticated management endpoints.
    app.post('/api/v2/public-shares', ctrl.createShare);
    app.get('/api/v2/public-shares', ctrl.getShare);
    app.put('/api/v2/public-shares/:id', ctrl.updateShare);
    app.get('/api/v2/intake', ctrl.listIntake);
    app.post('/api/v2/intake/review', ctrl.reviewIntake);

    // Unauthenticated public pages (server-rendered HTML).
    app.get('/share/:token', renderer.renderShare);
    app.post('/share/:token/intake', renderer.submitIntake);
}

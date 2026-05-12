const ctrl = require('./controller');

exports.init = (app) => {
    app.get('/api/v1/settings/oauth', ctrl.getOAuthCred);
    app.post('/api/v1/settings/oauth', ctrl.updateOAuthCred);
}
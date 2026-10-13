const { requireInstanceAdmin } = require('../Instance/guard');
const ctrl = require('./controller');

exports.init = (app) => {
    app.get('/api/v1/settings/oauth', requireInstanceAdmin, ctrl.getOAuthCred);
    app.post('/api/v1/settings/oauth', requireInstanceAdmin, ctrl.updateOAuthCred);
}
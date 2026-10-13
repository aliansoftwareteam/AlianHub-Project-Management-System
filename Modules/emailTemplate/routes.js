const { requireInstanceAdmin } = require('../Instance/guard');
const ctrl = require('./controller');

exports.init = (app) => {
    app.post('/api/v1/updateEmailTemplate', requireInstanceAdmin, ctrl.updateEmailTemplate);
}
const ctrl = require('./controller');
const { agentsRefused } = require('../../Agents/guard');

exports.init = (app) => {
    app.put('/api/v1/currency/:cid/:id', agentsRefused('workspace.settings'), ctrl.updateCurrency);
    app.get('/api/v1/currency', ctrl.getCurrency);
}
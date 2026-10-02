const ctrl = require('./controller');
const { requireCompanyAdmin } = require('../../../Config/permissionGuard');
const { agentsRefused } = require('../../Agents/guard');

exports.init = (app) => {
    app.get('/api/v1/setting/designation', ctrl.getDesignations);
    app.put('/api/v1/setting/designation/update', agentsRefused('workspace.settings'), requireCompanyAdmin({ permission: 'settings.settings_designation' }), ctrl.updateDesignation);
}

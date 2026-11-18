const ctrl = require('./controller');
const { requireCompanyAdmin } = require('../../../Config/permissionGuard');

exports.init = (app) => {
    app.get('/api/v1/setting/roles', ctrl.getRoles);
    app.put('/api/v1/setting/roles/update', requireCompanyAdmin({ permission: 'settings.settings_role_management' }), ctrl.updateRole);
}

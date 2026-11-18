const ctrl = require('./controller');
const { requireCompanyAdmin, requirePermission } = require('../../../Config/permissionGuard');

exports.init = (app) => {
    app.put(
        '/api/v1/securityPermissions',
        requireCompanyAdmin({ permission: 'settings.settings_security_permissions' }),
        requirePermission('settings.settings_security_permissions'),
        ctrl.updateSecurityPermissions,
    );
    app.get('/api/v1/securityPermissions', ctrl.getSecurityPermissions);
}

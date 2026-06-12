const ctrl = require('./controller');
const { requirePermission } = require('../../../Config/permissionGuard');

exports.init = (app) => {
    // Mirrors the frontend gate EXACTLY (SecurityPermissions.vue checks
    // settings.settings_security_permissions; owner/admin bypass). Any user
    // the web app lets edit permissions can still edit them here; everyone
    // else is blocked — closing the previous "no server-side check" hole
    // (a normal member without the permission could grant themselves any
    // permission via the API). Zero web-app regression by construction.
    app.put('/api/v1/securityPermissions', requirePermission('settings.settings_security_permissions'), ctrl.updateSecurityPermissions);
    app.get('/api/v1/securityPermissions', ctrl.getSecurityPermissions);
}

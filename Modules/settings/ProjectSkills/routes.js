const ctrl = require('./controller');
const { requireCompanyAdmin, requirePermission } = require('../../../Config/permissionGuard');

exports.init = (app) => {
    app.get('/api/v1/setting/skills', ctrl.getProjectSkills);
    app.put(
        '/api/v1/setting/skills',
        requireCompanyAdmin({ permission: 'settings.settings_edit_company' }),
        requirePermission('settings.settings_edit_company'),
        ctrl.updateProjectSkills,
    );
}

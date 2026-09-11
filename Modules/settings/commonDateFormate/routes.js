const ctrl = require('./controller');
const { requireCompanyAdmin } = require('../../../Config/permissionGuard');

exports.init = (app) => {
    app.put('/api/v1/commonDateFormate', requireCompanyAdmin({ permission: 'settings.settings_edit_company' }), ctrl.updateCommonDateFormate);
    app.get('/api/v1/commonDateFormate', ctrl.getCommonDateFormate);
}

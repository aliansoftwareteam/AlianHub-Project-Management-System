const ctrl = require('./controller');
const { requireCompanyAdmin } = require('../../../Config/permissionGuard');

exports.init = (app) => {
    app.put('/api/v1/fileExtensions', requireCompanyAdmin({ permission: 'settings.settings_file_extensions' }), ctrl.updateFileExtensions);
    app.get('/api/v1/fileExtensions', ctrl.getFileExtensions);
}

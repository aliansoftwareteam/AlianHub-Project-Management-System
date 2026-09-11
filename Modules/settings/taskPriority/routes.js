const ctrl = require('./controller');
const { requireCompanyAdmin } = require('../../../Config/permissionGuard');

exports.init = (app) => {
    app.put('/api/v1/taskPriority', requireCompanyAdmin({ permission: 'settings.settings_task_priority' }), ctrl.updateTaskPriority);
    app.get('/api/v1/taskPriority', ctrl.getTaskPriority);
}

const ctrl = require('./controller');
const { requireCompanyAdmin } = require('../../../Config/permissionGuard');

exports.init = (app) => {
    app.get('/api/v1/milestoneRange', ctrl.getMilestoneRange);
    app.put('/api/v1/milestoneStatus', requireCompanyAdmin({ permission: 'settings.settings_project_milestone_status' }), ctrl.updateMilestoneStatus);
    app.get('/api/v1/milestoneStatus', ctrl.getMilestoneProjectStatus);
    app.get('/api/v1/milestoneBillingPeriod', ctrl.getMilestoneBillingPeriod);
}

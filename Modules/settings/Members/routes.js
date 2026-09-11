const ctrl = require('./controller');
const { requirePermission } = require('../../../Config/permissionGuard');

exports.init = (app) => {
    app.get('/api/v1/members', ctrl.getMembers);
    app.get('/api/v1/members/:id', ctrl.getMembersById);
    app.get('/api/v1/members/:key/:value', ctrl.checkRoleOrDesignationAssignedWithUsers);
    app.post('/api/v1/members/private-view', ctrl.handlePrivateView);
    app.put('/api/v1/members', requirePermission('settings.settings_member_list'), ctrl.updateMember);
    app.put('/api/v1/root-members', requirePermission('settings.settings_member_list'), ctrl.rootUpdateMember);
    app.post('/api/v1/members/count', ctrl.getMembersCount);
}

const ctrl = require('./controller');
const { requirePermission } = require('../../../Config/permissionGuard');
const { isOwnInvitationAcceptance, isOwnPreferenceUpdate } = require('./membershipGuard');

exports.init = (app) => {
    app.get('/api/v1/members', ctrl.getMembers);
    app.get('/api/v1/members/:id', ctrl.getMembersById);
    app.get('/api/v1/members/:key/:value', ctrl.checkRoleOrDesignationAssignedWithUsers);
    app.post('/api/v1/members/private-view', ctrl.handlePrivateView);
    app.put('/api/v1/members', requirePermission('settings.settings_member_list', { sessionAllows: isOwnPreferenceUpdate }), ctrl.updateMember);
    app.put('/api/v1/root-members', requirePermission('settings.settings_member_list', { sessionAllows: isOwnInvitationAcceptance }), ctrl.rootUpdateMember);
    app.post('/api/v1/members/count', ctrl.getMembersCount);
}

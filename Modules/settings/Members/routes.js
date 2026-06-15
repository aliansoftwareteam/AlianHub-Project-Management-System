const ctrl = require('./controller');
const { requirePermission } = require('../../../Config/permissionGuard');

exports.init = (app) => {
    app.get('/api/v1/members', ctrl.getMembers);
    app.get('/api/v1/members/:id', ctrl.getMembersById);
    app.get('/api/v1/members/:key/:value', ctrl.checkRoleOrDesignationAssignedWithUsers);
    // Member self-service (private views) — not gated.
    app.post('/api/v1/members/private-view', ctrl.handlePrivateView);
    // Mirrors the frontend gate (Members.vue: settings_member_list === true;
    // owner/admin bypass). Closes the previous "no check" hole where any
    // member could PUT arbitrary fields. The TRULY dangerous part — setting
    // roleType to owner/admin — is additionally blocked in the controller
    // (owner-only, ALWAYS enforced, independent of the enforcement flag).
    app.put('/api/v1/members', requirePermission('settings.settings_member_list'), ctrl.updateMember);
    app.put('/api/v1/root-members', requirePermission('settings.settings_member_list'), ctrl.rootUpdateMember);
    app.post('/api/v1/members/count', ctrl.getMembersCount);
}

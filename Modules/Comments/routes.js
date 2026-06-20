const ctrl = require('./controller');
const { requireGuestProjectAccess } = require('../../Config/permissionGuard');

exports.init = (app) => {
    app.post('/api/v1/comments', requireGuestProjectAccess((req) => req.body?.data?.objId?.projectId || req.body?.objId?.projectId), ctrl.save);
    app.put('/api/v1/comments', requireGuestProjectAccess((req) => req.body?.data?.objId?.projectId || req.body?.objId?.projectId), ctrl.update);
    app.get('/api/v1/comments/get-paginated-messages', requireGuestProjectAccess((req) => req.query?.projectId), ctrl.getPaginatedMessages);
    app.get('/api/v1/comments/get-searched-messages', requireGuestProjectAccess((req) => req.query?.projectId), ctrl.searchMessageFromMainChat);
}
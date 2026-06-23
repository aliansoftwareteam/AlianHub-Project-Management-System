const ctrl = require('./controller');

exports.init = (app) => {
    // JWT + companyId enforced in setMiddleware (prefix /api/v1/pto). Role checks
    // (approve = owner/admin; members manage their own) are enforced in-controller.
    app.post('/api/v1/pto', ctrl.createPto);
    app.get('/api/v1/pto', ctrl.listPto);
    // Registered before any ':id' route so "capacity" isn't captured as an id.
    app.get('/api/v1/pto/capacity', ctrl.getCapacity);
    app.put('/api/v1/pto/:id/status', ctrl.updatePtoStatus);
    app.delete('/api/v1/pto/:id', ctrl.deletePto);
};

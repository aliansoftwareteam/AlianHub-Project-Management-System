const ctrl = require('./controller');

exports.init = (app) => {
    // JWT + companyId enforced in setMiddleware (/api/v1/reports/capacity).
    app.get('/api/v1/reports/capacity', ctrl.getCapacityPlan);
};

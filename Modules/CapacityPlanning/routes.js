const ctrl = require('./controller');

exports.init = (app) => {
    app.get('/api/v1/reports/capacity', ctrl.getCapacityPlan);
    app.get('/api/v1/reports/capacity/months', ctrl.getMonthlyCapacity);
};

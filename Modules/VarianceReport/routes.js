const ctrl = require('./controller');

exports.init = (app) => {
    app.get('/api/v1/reports/variance', ctrl.getVarianceReport);
    app.get('/api/v1/reports/variance/summary', ctrl.getVarianceSummary);
};

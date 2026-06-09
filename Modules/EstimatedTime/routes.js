const ctrl = require('./controller');

exports.init = (app) => {
    app.get('/api/v1/estimatedTime/:pid/:tid',ctrl.getEstimatedTime);
    app.put('/api/v1/estimatedTime',ctrl.updateEstimatedTime);
    app.post('/api/v1/estimatedTime', ctrl.getEstimateByAggregate);
    // Manual AI-estimate trigger from the task detail sidebar. Path-only
    // params so the existing axios interceptor's companyId header flows
    // through unchanged — matches the convention used by other v1 routes
    // in this module.
    app.post('/api/v1/estimatedTime/ai/:tid', ctrl.generateAiEstimate);
}
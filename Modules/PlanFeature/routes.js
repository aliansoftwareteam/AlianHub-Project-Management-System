const ctrl = require('./controller')

exports.init = (app) => {
    app.get('/api/v1/plan-feature-display',ctrl.planFeatureDisplay)
    app.get('/api/v1/admin/plan-feature',ctrl.planFeature)
    app.get('/api/v1/admin/plan-feature-display',ctrl.planFeatureDisplay)
}
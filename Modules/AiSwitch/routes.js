const ctrl = require('./controller');

exports.init = (app) => {
    // Any member reads what the AI screens should show; only an owner or admin, never an API token, turns AI off.
    app.get('/api/v2/ai-switch', ctrl.getAvailability);
    app.put('/api/v2/ai-switch', ctrl.setWorkspaceSwitch);
};

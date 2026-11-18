const ctrl = require('./controller');

exports.init = (app) => {
    app.get('/api/v2/plan/usage', ctrl.usage);
    app.get('/api/v2/plan/workspaces', ctrl.workspaces);
};

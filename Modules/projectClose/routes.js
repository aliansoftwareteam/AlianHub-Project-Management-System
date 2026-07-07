const ctrl = require('./controller');

exports.init = (app) => {
    // Auto-close inactive projects — per-company settings (owner-only PUT).
    app.get('/api/v1/project-close', ctrl.getSettings);   // read policy (any authed member)
    app.put('/api/v1/project-close', ctrl.updateSettings); // update policy (company owner)
};

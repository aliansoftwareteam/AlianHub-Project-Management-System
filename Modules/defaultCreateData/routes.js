const ctrl = require('./controller');

// Manual trigger for the demo DB reset. Guarded by DEMO_MODE so it's a
// no-op on real deployments — the seed drops and reseeds the fixed demo
// company's collections, which would nuke a real tenant if left open.
const demoModeGuard = (req, res, next) => {
    if (process.env.DEMO_MODE !== 'true') {
        return res.status(404).send('Not found');
    }
    next();
};

exports.init = (app) => {
    app.get('/api/v1/createdefaultcompany', demoModeGuard, ctrl.createdefaultcompany);
}
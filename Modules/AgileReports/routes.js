const { getSprintBurndown } = require('../Sprints/burndown');
const velocity = require('./velocity');
const cfd = require('./cfd');

exports.init = (app) => {
    // Unified agile-reports read API (S4). Burndown reuses the existing Sprints
    // handler (now query-param aware); velocity + CFD are computed in this module.
    // All read-only; auth/companyId come from the global middleware like other routes.
    app.get('/api/v1/agile/burndown', getSprintBurndown);
    app.get('/api/v1/agile/velocity', velocity.getVelocity);
    app.get('/api/v1/agile/cfd', cfd.getCFD);
};

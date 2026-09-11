const ctrl = require('./controller');
const { READ, requireProjectAccess } = require('../../Config/projectAccess');

exports.init = (app) => {
    // JWT + companyId enforced in setMiddleware (prefix /api/v1/project-dashboard),
    // so req.uid / req.aud are populated before the handler runs.
    app.get('/api/v1/project-dashboard/:projectId', requireProjectAccess({ mode: READ, projectIds: (req) => req.params.projectId }), ctrl.getProjectDashboard);
};

const ctrl = require('./controller');
const { requireProjectAccess, SECURITY_SETTINGS } = require('../../Config/projectAccess');

exports.init = (app) => {
    app.get('/api/v1/projectRules/:pid', ctrl.getProjectRules);
    app.put('/api/v1/projectRules/update', requireProjectAccess({ projectIds: (req) => req.body && req.body.projectId, permissions: () => [SECURITY_SETTINGS] }), ctrl.updateProjectRules);
    app.delete('/api/v1/projectRules/delete/:pid', requireProjectAccess({ projectIds: (req) => req.params.pid, permissions: () => [SECURITY_SETTINGS] }), ctrl.deleteProjectRules);
}

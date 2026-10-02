const ctrl = require('./controller');
const { requirePermission } = require('../../Config/permissionGuard');
const { requireProjectAccess, READ } = require('../../Config/projectAccess');
const { agentsRefused } = require('../Agents/guard');

/* A project the caller cannot open answers 404, as does one that is not there. */
const canOpen = requireProjectAccess({ mode: READ, projectIds: (req) => req.params.id, passMissing: () => false });

exports.init = (app) => {
    app.post('/api/v2/projects/:id/duplicate', agentsRefused('project.create'), canOpen, requirePermission('project.project_create'), ctrl.duplicate);
    app.get('/api/v2/projects/:id/duplicate', canOpen, ctrl.progress);
};

const ctrl = require('./controller');
const { requirePermission } = require('../../Config/permissionGuard');
const { requireProjectAccess, READ } = require('../../Config/projectAccess');
const { agentsRefused } = require('../Agents/guard');

/* A project the caller cannot open answers 404, as does one that is not there. */
const canOpen = requireProjectAccess({ mode: READ, projectIds: (req) => req.params.id, passMissing: () => false });
const mayCreateProjects = requirePermission('project.project_create');

exports.init = (app) => {
    app.post('/api/v2/projects/:id/template', agentsRefused('template.save'), canOpen, mayCreateProjects, ctrl.save);
    app.get('/api/v2/projects/templates', mayCreateProjects, ctrl.list);
    app.post('/api/v2/projects/templates/:id/use', agentsRefused('project.create'), mayCreateProjects, ctrl.use);
    app.patch('/api/v2/projects/templates/:id', agentsRefused('template.update'), ctrl.edit);
    app.delete('/api/v2/projects/templates/:id', ctrl.remove);
};

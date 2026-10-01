const ctrl = require('./controller');
const { requirePermission } = require('../../Config/permissionGuard');
const { requireProjectAccess, READ } = require('../../Config/projectAccess');

/* A project the caller cannot open answers 404, as does one that is not there. */
const canOpen = requireProjectAccess({ mode: READ, projectIds: (req) => req.params.id, passMissing: () => false });
const mayCreateProjects = requirePermission('project.project_create');

exports.init = (app) => {
    app.post('/api/v2/projects/:id/template', canOpen, mayCreateProjects, ctrl.save);
    app.get('/api/v2/projects/templates', mayCreateProjects, ctrl.list);
    app.post('/api/v2/projects/templates/:id/use', mayCreateProjects, ctrl.use);
    app.patch('/api/v2/projects/templates/:id', ctrl.edit);
    app.delete('/api/v2/projects/templates/:id', ctrl.remove);
};

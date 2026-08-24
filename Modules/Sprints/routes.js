const ctrl = require('./controller');
const burndown = require('./burndown');
const hours = require('./hours');
const scrum = require('./scrum');
const { requirePermission } = require('../../Config/permissionGuard');

// Whitelist of functions allowed to be called via PATCH /sprint/:id
const ALLOWED_SPRINT_TYPES = ['editSprintName', 'updateSprint', 'deleteChannel'];

// Whitelist of functions allowed to be called via PATCH /folder/:id
const ALLOWED_FOLDER_TYPES = ['editFolderName', 'updateFolder'];

exports.init = (app) => {
    // Read-only burndown series for a sprint (count + estimate based).
    app.post('/api/v2/sprints/burndown', burndown.getSprintBurndown);

    // Read-only Planned / Logged / Overdue totals for a whole sprint.
    app.post('/api/v2/sprints/hours', hours.getSprintHours);

    // Scrum lifecycle. Deliberately under /api/v2/sprints: setMiddleware.js
    // registers that as a PREFIX, so these are behind a token by default.
    // /api/v1/sprints (plural) is NOT registered anywhere and would be open.
    //
    // Gated on project_sprint_create rather than a new project_sprint_manage
    // key: the permission catalogue in utils/data.js is seeded at COMPANY
    // IMPORT, so a brand-new key exists for new companies only and would deny
    // every existing one. Whoever may create a sprint may run its lifecycle.
    const canManageSprint = requirePermission('project.project_sprint_create');
    app.post('/api/v2/sprints/scrum', canManageSprint, scrum.setScrum);
    app.post('/api/v2/sprints/start', canManageSprint, scrum.startSprint);
    app.post('/api/v2/sprints/complete', canManageSprint, scrum.completeSprint);
    app.get('/api/v2/sprints/complete-preview', requirePermission('project.project_sprint_create', { write: false }), scrum.completePreview);
    app.post('/api/v2/sprints/backlog', canManageSprint, scrum.getBacklog);

    app.post('/api/v1/sprint', requirePermission('project.project_sprint_create'), ctrl.addSprint);
    app.patch('/api/v1/sprint/:id', (req, res) => {
        if(!req?.body?.type) {
            res.send({status: false, statusText: "type not found"});
            return;
        }
        if(!req?.params?.id) {
            res.send({status: false, statusText: "id is required"});
            return;
        }
        // Security: only allow whitelisted handler names to prevent arbitrary function invocation
        if(!ALLOWED_SPRINT_TYPES.includes(req.body.type)) {
            res.status(400).send({status: false, statusText: "Invalid type"});
            return;
        }
        ctrl[req.body.type](req,res);
    });

    app.post('/api/v1/folder', ctrl.addFolder);
    app.patch('/api/v1/folder/:id', (req, res) => {
        if(!req?.body?.type) {
            res.send({status: false, statusText: "type not found"});
            return;
        }
        if(!req?.params?.id) {
            res.send({status: false, statusText: "id is required"});
            return;
        }
        // Security: only allow whitelisted handler names to prevent arbitrary function invocation
        if(!ALLOWED_FOLDER_TYPES.includes(req.body.type)) {
            res.status(400).send({status: false, statusText: "Invalid type"});
            return;
        }
        ctrl[req.body.type](req,res);
    });
}
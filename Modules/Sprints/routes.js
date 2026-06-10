const ctrl = require('./controller');
const burndown = require('./burndown');

// Whitelist of functions allowed to be called via PATCH /sprint/:id
const ALLOWED_SPRINT_TYPES = ['editSprintName', 'updateSprint'];

// Whitelist of functions allowed to be called via PATCH /folder/:id
const ALLOWED_FOLDER_TYPES = ['editFolderName', 'updateFolder'];

exports.init = (app) => {
    // Read-only burndown series for a sprint (count + estimate based).
    app.post('/api/v2/sprints/burndown', burndown.getSprintBurndown);

    app.post('/api/v1/sprint', ctrl.addSprint);
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
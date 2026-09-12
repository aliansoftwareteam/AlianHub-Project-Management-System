const ctrl = require('./controller');
const burndown = require('./burndown');
const hours = require('./hours');
const scrum = require('./scrum');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { READ, WRITE, requireProjectAccess, projectIdsFrom } = require('../../Config/projectAccess');
const { requireSprintAccess } = require('./helpers/sprintVisibility');

// Whitelist of functions allowed to be called via PATCH /sprint/:id
const ALLOWED_SPRINT_TYPES = ['editSprintName', 'updateSprint', 'deleteChannel'];

// Whitelist of functions allowed to be called via PATCH /folder/:id
const ALLOWED_FOLDER_TYPES = ['editFolderName', 'updateFolder'];

// Gated on project_sprint_create rather than a new project_sprint_manage key: the
// permission catalogue in utils/data.js is seeded at COMPANY IMPORT, so a brand-new key
// exists for new companies only and would deny every existing one.
const SPRINT_CREATE = 'project.project_sprint_create';
const SPRINT_EDIT = ['project.project_sprint_name_edit', 'project.sprint_type_change', SPRINT_CREATE];
const SPRINT_STATUS = { 0: 'project.sprint_restore', 1: 'project.sprint_delete', 2: 'project.sprint_archive' };
const FOLDER_RENAME = 'project.project_folder_name_edit';
const FOLDER_STATUS = { 0: 'project.folder_restore', 1: 'project.folder_delete', 2: 'project.folder_archive' };

const bodyOf = (req) => req.body || {};

// The project guard lets any project member through, so the scrum board needs the sprint
// rule on top: a private sprint is only its assignees', their teams' and the admins'.
const onSprint = (pick) => requireSprintAccess(pick);

const sprintProject = (pick, direct) => projectIdsFrom({ records: [[SCHEMA_TYPE.SPRINTS, pick]], direct });

// Chat channels share the sprint and folder collections, and their container is not a project.
const guard = (mode, projectIds, permissions = () => []) => requireProjectAccess({ mode, projectIds, permissions, passMissing: () => true });

const sprintPatchPermissions = (req) => {
    const { type, updatedValueDeleteStatusKey } = bodyOf(req);
    if (type === 'editSprintName') return ['project.project_sprint_name_edit'];
    if (type === 'deleteChannel') return [SPRINT_STATUS[1]];
    return [SPRINT_STATUS[updatedValueDeleteStatusKey] || SPRINT_EDIT];
};

const folderPatchPermissions = (req) => {
    const { type, updatedValueDeleteStatusKey } = bodyOf(req);
    if (type === 'editFolderName') return [FOLDER_RENAME];
    return [FOLDER_STATUS[updatedValueDeleteStatusKey] || FOLDER_RENAME];
};

exports.init = (app) => {
    const burndownSprint = (req) => bodyOf(req).sprintId || (req.query && req.query.sprintId);
    app.post('/api/v2/sprints/burndown', guard(READ, sprintProject(burndownSprint)), onSprint(burndownSprint), burndown.getSprintBurndown);
    app.post('/api/v2/sprints/hours', guard(READ, sprintProject((req) => bodyOf(req).sprintId)), onSprint((req) => bodyOf(req).sprintId), hours.getSprintHours);

    // Scrum lifecycle. Deliberately under /api/v2/sprints: setMiddleware.js
    // registers that as a PREFIX, so these are behind a token by default.
    // /api/v1/sprints (plural) is NOT registered anywhere and would be open.
    const managesSprint = guard(WRITE, sprintProject((req) => [bodyOf(req).sprintId, bodyOf(req).incompleteDestination]), () => [SPRINT_CREATE]);
    const writesSprint = onSprint((req) => [bodyOf(req).sprintId, bodyOf(req).incompleteDestination]);
    app.post('/api/v2/sprints/scrum', managesSprint, writesSprint, scrum.setScrum);
    app.post('/api/v2/sprints/start', managesSprint, writesSprint, scrum.startSprint);
    app.post('/api/v2/sprints/complete', managesSprint, writesSprint, scrum.completeSprint);
    app.get('/api/v2/sprints/complete-preview', guard(READ, sprintProject((req) => req.query && req.query.sprintId)), onSprint((req) => req.query && req.query.sprintId), scrum.completePreview);
    app.post('/api/v2/sprints/backlog', guard(READ, (req) => bodyOf(req).projectId), scrum.getBacklog);
    app.get('/api/v2/sprints/report', guard(READ, sprintProject((req) => req.query && req.query.sprintId)), onSprint((req) => req.query && req.query.sprintId), scrum.sprintReport);

    const addsSprint = projectIdsFrom({ records: [[SCHEMA_TYPE.FOLDERS, (req) => bodyOf(req).folder && bodyOf(req).folder.folderId]], direct: (req) => bodyOf(req).projectId });
    app.post('/api/v1/sprint', guard(WRITE, addsSprint, () => [SPRINT_CREATE]), ctrl.addSprint);
    app.patch('/api/v1/sprint/:id', guard(WRITE, sprintProject((req) => [req.params.id, bodyOf(req).prevData], (req) => bodyOf(req).projectId), sprintPatchPermissions), (req, res) => {
        if(!req?.body?.type) {
            res.send({status: false, statusText: "type not found"});
            return;
        }
        if(!req?.params?.id) {
            res.send({status: false, statusText: "id is required"});
            return;
        }
        if(!ALLOWED_SPRINT_TYPES.includes(req.body.type)) {
            res.status(400).send({status: false, statusText: "Invalid type"});
            return;
        }
        ctrl[req.body.type](req,res);
    });

    app.post('/api/v1/folder', guard(WRITE, (req) => bodyOf(req).projectId, () => ['project.project_folder_create']), ctrl.addFolder);
    const folderProject = projectIdsFrom({ records: [[SCHEMA_TYPE.FOLDERS, (req) => req.params.id]], direct: (req) => [bodyOf(req).projectId, bodyOf(req).projectData] });
    app.patch('/api/v1/folder/:id', guard(WRITE, folderProject, folderPatchPermissions), (req, res) => {
        if(!req?.body?.type) {
            res.send({status: false, statusText: "type not found"});
            return;
        }
        if(!req?.params?.id) {
            res.send({status: false, statusText: "id is required"});
            return;
        }
        if(!ALLOWED_FOLDER_TYPES.includes(req.body.type)) {
            res.status(400).send({status: false, statusText: "Invalid type"});
            return;
        }
        ctrl[req.body.type](req,res);
    });
}

const ctrl = require('./controller');
const burndown = require('./burndown');
const hours = require('./hours');
const scrum = require('./scrum');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { READ, WRITE, requireProjectAccess, projectIdsFrom } = require('../../Config/projectAccess');
const { requireSprintAccess } = require('./helpers/sprintVisibility');
const { sprintUpdateFrom, sprintWriteKinds, folderUpdateFrom, writtenStatus } = require('./helpers/listWrites');
const { withActingUser } = require('./helpers/actingUser');
const { newSprintNamesOnlyMembers, sprintPatchNamesOnlyMembers } = require('./helpers/sprintPeople');
const { CHAT_CHANNEL, CHAT_CATEGORY, isChatSpace, requireChatAccess } = require('./helpers/chatAccess');
const { agentsRefused, agentsReadAlone } = require('../Agents/guard');

const ALLOWED_SPRINT_TYPES = ['editSprintName', 'updateSprint', 'deleteChannel'];
const ALLOWED_FOLDER_TYPES = ['editFolderName', 'updateFolder', 'moveFolder'];

// Gated on project_sprint_create rather than a new project_sprint_manage key: the
// permission catalogue in utils/data.js is seeded at COMPANY IMPORT, so a brand-new key
// exists for new companies only and would deny every existing one.
const SPRINT_CREATE = 'project.project_sprint_create';
const SPRINT_EDIT = ['project.project_sprint_name_edit', 'project.sprint_type_change', SPRINT_CREATE];
const SPRINT_SHARE = 'project.sprint_type_change';
const SPRINT_STATUS = { 0: 'project.sprint_restore', 1: 'project.sprint_delete', 2: 'project.sprint_archive', 5: 'project.sprint_archive' };
const FOLDER_RENAME = 'project.project_folder_name_edit';
const FOLDER_MOVE = [FOLDER_RENAME, 'project.project_folder_create'];
const FOLDER_STATUS = { 0: 'project.folder_restore', 1: 'project.folder_delete', 2: 'project.folder_archive' };

const bodyOf = (req) => req.body || {};

// The project guard lets any project member through, so the scrum board needs the sprint
// rule on top: a private sprint is only its assignees', their teams' and the admins'.
const onSprint = (pick) => requireSprintAccess(pick);

const sprintProject = (pick, direct) => projectIdsFrom({ records: [[SCHEMA_TYPE.SPRINTS, pick]], direct });

const listsByPeople = agentsRefused('sprint.create');

/* Reading a backlog makes the Backlog list of a project that has none, and a list is not an agent's to add on a route. */
const backlogMadeByPeople = agentsReadAlone('sprint.create');

// Chat channels and categories share the sprint and folder collections; their container is a chat space, not a project.
const guard = (mode, projectIds, permissions = () => [], chatPermission = () => CHAT_CHANNEL) => (mode === READ
    ? [requireProjectAccess({ mode, projectIds, permissions })]
    : [requireProjectAccess({ mode, projectIds, permissions, passMissing: isChatSpace }), requireChatAccess({ containers: projectIds, permission: chatPermission })]);

// An update the handler will refuse still has to pass a permission first.
const orRefused = (build, fallback) => {
    try {
        return build();
    } catch (error) {
        return [fallback];
    }
};

const sprintUpdatePermissions = (req) => orRefused(() => {
    const { status, moves, shares } = sprintWriteKinds(sprintUpdateFrom(bodyOf(req).updateObject), req.uid);
    return [
        ...(status === undefined ? [] : [SPRINT_STATUS[status]]),
        ...(moves ? [SPRINT_EDIT] : []),
        ...(shares ? [SPRINT_SHARE] : []),
    ];
}, SPRINT_EDIT);

const sprintPatchPermissions = (req) => {
    const { type } = bodyOf(req);
    if (type === 'editSprintName') return ['project.project_sprint_name_edit'];
    if (type === 'deleteChannel') return [SPRINT_STATUS[1]];
    return sprintUpdatePermissions(req);
};

const folderPatchPermissions = (req) => {
    const { type, updateObject } = bodyOf(req);
    if (type === 'editFolderName') return [FOLDER_RENAME];
    if (type === 'moveFolder') return [FOLDER_MOVE];
    return orRefused(() => [FOLDER_STATUS[writtenStatus(folderUpdateFrom(updateObject))]], FOLDER_RENAME);
};

exports.init = (app) => {
    const burndownSprint = (req) => bodyOf(req).sprintId || (req.query && req.query.sprintId);
    app.post('/api/v2/sprints/burndown', ...guard(READ, sprintProject(burndownSprint)), onSprint(burndownSprint), burndown.getSprintBurndown);
    app.post('/api/v2/sprints/hours', ...guard(READ, sprintProject((req) => bodyOf(req).sprintId)), onSprint((req) => bodyOf(req).sprintId), hours.getSprintHours);

    // Scrum lifecycle. Deliberately under /api/v2/sprints: setMiddleware.js
    // registers that as a PREFIX, so these are behind a token by default.
    // /api/v1/sprints (plural) is NOT registered anywhere and would be open.
    const managesSprint = guard(WRITE, sprintProject((req) => [bodyOf(req).sprintId, bodyOf(req).incompleteDestination]), () => [SPRINT_CREATE]);
    const writesSprint = onSprint((req) => [bodyOf(req).sprintId, bodyOf(req).incompleteDestination]);
    app.post('/api/v2/sprints/scrum', agentsRefused('sprint.scrum'), ...managesSprint, writesSprint, scrum.setScrum);
    app.post('/api/v2/sprints/start', agentsRefused('sprint.start'), ...managesSprint, writesSprint, scrum.startSprint);
    app.post('/api/v2/sprints/complete', agentsRefused('sprint.complete'), ...managesSprint, writesSprint, scrum.completeSprint);
    app.get('/api/v2/sprints/complete-preview', ...guard(READ, sprintProject((req) => req.query && req.query.sprintId)), onSprint((req) => req.query && req.query.sprintId), scrum.completePreview);
    app.post('/api/v2/sprints/backlog', backlogMadeByPeople, ...guard(READ, (req) => bodyOf(req).projectId), scrum.getBacklog);
    app.get('/api/v2/sprints/report', ...guard(READ, sprintProject((req) => req.query && req.query.sprintId)), onSprint((req) => req.query && req.query.sprintId), scrum.sprintReport);

    const addsSprint = projectIdsFrom({ records: [[SCHEMA_TYPE.FOLDERS, (req) => bodyOf(req).folder && bodyOf(req).folder.folderId]], direct: (req) => bodyOf(req).projectId });
    app.post('/api/v1/sprint', listsByPeople, ...guard(WRITE, addsSprint, () => [SPRINT_CREATE]), withActingUser, newSprintNamesOnlyMembers, ctrl.addSprint);
    app.patch('/api/v1/sprint/:id', agentsRefused('sprint.update'), ...guard(WRITE, sprintProject((req) => req.params.id, (req) => bodyOf(req).projectId), sprintPatchPermissions), onSprint((req) => req.params.id), withActingUser, sprintPatchNamesOnlyMembers, (req, res) => {
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

    app.post('/api/v1/folder', agentsRefused('folder.create'), ...guard(WRITE, (req) => bodyOf(req).projectId, () => ['project.project_folder_create'], () => CHAT_CATEGORY), withActingUser, ctrl.addFolder);
    const folderProject = projectIdsFrom({ records: [[SCHEMA_TYPE.FOLDERS, (req) => req.params.id]], direct: (req) => [bodyOf(req).projectId, bodyOf(req).projectData] });
    app.patch('/api/v1/folder/:id', agentsRefused('folder.update'), ...guard(WRITE, folderProject, folderPatchPermissions, () => CHAT_CATEGORY), withActingUser, (req, res) => {
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

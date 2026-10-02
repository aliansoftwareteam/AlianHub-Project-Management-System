const Projectctrl = require('./controller/getProjectById');
const projectListCtrl = require('./controller/getProjectList');
const updateProjectCtrl = require('./controller/updateProject');
const projectAlltaskUpdateCtrl = require('./controller/projectAlltaskUpdate');
const projectSprintFolderCtrl = require('./controller/getSprintFolder');
const projectSprintUpdateCtrl = require('./controller/updateSprint');
const projectFilterCtrl = require('./controller/getProjectFilterData');
const manageGlobalFilterCtrl = require('./controller/manageGlobalFilter');
const checklistCtrl = require('./controller/checklist');
const tagsCtrl = require('./controller/tags');
const getQueryCtrl = require('./controller/getQueryFun');
const viewSettingsCtrl = require('./controller/viewSettings');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { projectUpdateNamesOnlyMembers } = require('./helpers/projectPeople');
const { sprintUpdateNamesOnlyMembers } = require('../Sprints/helpers/sprintPeople');
const { requireSprintAccess } = require('../Sprints/helpers/sprintVisibility');
const { CHAT_CHANNEL, isChatSpace, requireChatAccess } = require('../Sprints/helpers/chatAccess');
const { READ, requireProjectAccess, keepVisibleProjects, projectIdsFrom, fieldsOf, permissionsForProjectUpdate, requireSupportedProjectUpdate, DELETE_OR_CLOSE, FIELD_PERMISSIONS } = require('../../Config/projectAccess');
const { projectUpdateGuard, agentsRefused, projectAsked, PROJECT_TAGS_EDIT } = require('../Agents/guard');
const { limitCallerFilters } = require('../Company/helpers/callerQueryRules');

const CHECKLIST_ASSIGN_KEYS = ['assigneeAdd', 'assigneeRemove'];

const projectChanged = (projectIdOf) => projectAsked((req) => ({ action: 'project.update', params: { projectId: String(projectIdOf(req) || '') } }));
const SPRINT_EDIT = ['project.project_sprint_name_edit', 'project.sprint_type_change'];
const OWN_SPRINT_FIELDS = ['favouriteTasks'];

const checklistPermissions = (req) => (req.body.operation === 'update' && CHECKLIST_ASSIGN_KEYS.includes(req.body.key)
    ? [['project.project_checklist_assign_remove', 'project.project_checklist']]
    : ['project.project_checklist']);

const ownSprintFieldsOnly = (req) => fieldsOf(req.body && req.body.updateObject).every((field) => OWN_SPRINT_FIELDS.includes(field));
const sprintUpdatePermissions = (req) => (ownSprintFieldsOnly(req) ? [] : [SPRINT_EDIT]);
const sprintUpdateContainers = projectIdsFrom({ records: [[SCHEMA_TYPE.SPRINTS, (req) => req.params.id]], direct: (req) => req.body && req.body.updateObject && req.body.updateObject.projectId });
const projectOfSprint = projectIdsFrom({ records: [[SCHEMA_TYPE.SPRINTS, (req) => req.params.id]] });
const starred = projectAsked(async (req) => ({ action: 'sprint.favourite', params: { projectId: (await projectOfSprint(req))[0] || '' } }));

const readsProject = (projectIds) => requireProjectAccess({ mode: READ, projectIds });
const editsProjectViews = requireProjectAccess({ projectIds: (req) => req.params.id, permissions: () => [FIELD_PERMISSIONS.ProjectRequiredComponent] });
const viewsByPeople = agentsRefused('view.create');

exports.init = (app) => {
    app.post('/api/v1/project/search', limitCallerFilters('query'), projectFilterCtrl.projectFilter);
    app.get('/api/v1/project/:id', readsProject((req) => req.params.id), Projectctrl.getProjectById);
    app.get('/api/v1/project', projectListCtrl.getProjectList);
    app.put('/api/v1/project/:id', requireSupportedProjectUpdate, projectUpdateGuard, requireProjectAccess({ projectIds: (req) => req.params.id, permissions: (req) => permissionsForProjectUpdate(req.body && req.body.updateObject, req.uid) }), projectUpdateNamesOnlyMembers, projectChanged((req) => req.params.id), updateProjectCtrl.updateProject);
    app.put('/api/v1/project/:id/view-settings', viewsByPeople, editsProjectViews, viewSettingsCtrl.saveViewSettings);
    app.post('/api/v1/project/:id/views', viewsByPeople, editsProjectViews, viewSettingsCtrl.createView);
    app.put('/api/v1/project/allTask/:id', agentsRefused('project.delete'), requireProjectAccess({ projectIds: (req) => req.params.id, permissions: () => [DELETE_OR_CLOSE] }), projectAlltaskUpdateCtrl.projectAlltaskUpdate);
    app.get('/api/v1/project/sprintFolder/:id', readsProject((req) => req.params.id), projectSprintFolderCtrl.getSprintFolder);
    app.put('/api/v1/project/sprint/:id', requireProjectAccess({
        projectIds: sprintUpdateContainers,
        permissions: sprintUpdatePermissions,
        passMissing: isChatSpace,
    }), requireChatAccess({ containers: sprintUpdateContainers, permission: (req) => (ownSprintFieldsOnly(req) ? null : CHAT_CHANNEL) }),
    requireSprintAccess((req) => req.params.id), sprintUpdateNamesOnlyMembers, starred, projectSprintUpdateCtrl.updateSprint);
    app.post('/api/v1/project/filter/create', manageGlobalFilterCtrl.saveFilter);
    app.get('/api/v1/project/filter/:userId', manageGlobalFilterCtrl.getFilter);
    app.delete('/api/v1/project/filter/delete/:cid/:id', manageGlobalFilterCtrl.deleteFilter);
    app.put('/api/v1/project/filter/update', manageGlobalFilterCtrl.updateFilter);
    app.post('/api/v1/project/checklist', requireProjectAccess({ projectIds: (req) => req.body.id, permissions: checklistPermissions }), projectChanged((req) => req.body.id), checklistCtrl.handleChecklist);
    app.post('/api/v1/get-remaining-projects', keepVisibleProjects({ get: (req) => req.body && req.body.dataIds, set: (req, ids) => { req.body.dataIds = ids; } }), projectFilterCtrl.getRemainingProject);
    app.post('/api/v1/project/tags', agentsRefused(PROJECT_TAGS_EDIT), requireProjectAccess({ projectIds: (req) => req.body.id, permissions: () => ['task.task_tag'] }), tagsCtrl.handleTags);
    app.get('/api/v1/projectdata/taskData', readsProject(projectIdsFrom({ records: [[SCHEMA_TYPE.TASKS, (req) => req.query.taskId]], direct: (req) => req.query.projectId, conversations: true })), getQueryCtrl.getQueryFun)
}

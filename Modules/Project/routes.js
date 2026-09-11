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
const { requireProjectAccess, permissionsForProjectUpdate, DELETE_OR_CLOSE } = require('../../Config/projectAccess');

const CHECKLIST_ASSIGN_KEYS = ['assigneeAdd', 'assigneeRemove'];

const checklistPermissions = (req) => (req.body.operation === 'update' && CHECKLIST_ASSIGN_KEYS.includes(req.body.key)
    ? [['project.project_checklist_assign_remove', 'project.project_checklist']]
    : ['project.project_checklist']);

exports.init = (app) => {
    app.post('/api/v1/project/search',projectFilterCtrl.projectFilter);
    app.get('/api/v1/project/:id', Projectctrl.getProjectById);
    app.get('/api/v1/project', projectListCtrl.getProjectList);
    app.put('/api/v1/project/:id', requireProjectAccess({ projectIds: (req) => req.params.id, permissions: (req) => permissionsForProjectUpdate(req.body && req.body.updateObject) }), updateProjectCtrl.updateProject);
    app.put('/api/v1/project/allTask/:id', requireProjectAccess({ projectIds: (req) => req.params.id, permissions: () => [DELETE_OR_CLOSE] }), projectAlltaskUpdateCtrl.projectAlltaskUpdate);
    app.get('/api/v1/project/sprintFolder/:id', projectSprintFolderCtrl.getSprintFolder);
    app.put('/api/v1/project/sprint/:id',projectSprintUpdateCtrl.updateSprint);
    app.post('/api/v1/project/filter/create', manageGlobalFilterCtrl.saveFilter);
    app.get('/api/v1/project/filter/:userId', manageGlobalFilterCtrl.getFilter);
    app.delete('/api/v1/project/filter/delete/:cid/:id', manageGlobalFilterCtrl.deleteFilter);
    app.put('/api/v1/project/filter/update', manageGlobalFilterCtrl.updateFilter);
    app.post('/api/v1/project/checklist', requireProjectAccess({ projectIds: (req) => req.body.id, permissions: checklistPermissions }), checklistCtrl.handleChecklist);
    app.post('/api/v1/get-remaining-projects', projectFilterCtrl.getRemainingProject);
    app.post('/api/v1/project/tags', requireProjectAccess({ projectIds: (req) => req.body.id, permissions: () => ['task.task_tag'] }), tagsCtrl.handleTags);
    app.get('/api/v1/projectdata/taskData',getQueryCtrl.getQueryFun)
}

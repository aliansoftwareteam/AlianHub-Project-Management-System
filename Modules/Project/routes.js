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

const getQueryCtrl = require('./controller/getQueryFun')
exports.init = (app) => {
    app.post('/api/v1/project/search',projectFilterCtrl.projectFilter);
    app.get('/api/v1/project/:id', Projectctrl.getProjectById);
    app.get('/api/v1/project', projectListCtrl.getProjectList);
    app.put('/api/v1/project/:id',updateProjectCtrl.updateProject);
    app.put('/api/v1/project/allTask/:id',projectAlltaskUpdateCtrl.projectAlltaskUpdate);
    app.get('/api/v1/project/sprintFolder/:id', projectSprintFolderCtrl.getSprintFolder);
    app.put('/api/v1/project/sprint/:id',projectSprintUpdateCtrl.updateSprint);
    app.post('/api/v1/project/filter/create', manageGlobalFilterCtrl.saveFilter);
    app.get('/api/v1/project/filter/:userId', manageGlobalFilterCtrl.getFilter);
    app.delete('/api/v1/project/filter/delete/:cid/:id', manageGlobalFilterCtrl.deleteFilter);
    app.put('/api/v1/project/filter/update', manageGlobalFilterCtrl.updateFilter);
    app.post('/api/v1/project/checklist', checklistCtrl.handleChecklist);
    app.post('/api/v1/get-remaining-projects', projectFilterCtrl.getRemainingProject);
    app.post('/api/v1/project/tags', tagsCtrl.handleTags);
    app.get('/api/v1/projectdata/taskData',getQueryCtrl.getQueryFun)
}
const ctrl = require('./taskType/controller');
const ctrlTaskStatus = require('./taskStatus/controller');

const ctrlTaskTypeSetting = require('./settingTaskType/controller');
const ctrlTaskStatusSetting = require('./settingTaskStatus/controller');
const ctrlProjectStatusSetting = require('./settingProjectStatus/controller');
const { requireCompanyAdmin } = require('../../../Config/permissionGuard');

const companyAdmin = requireCompanyAdmin();

exports.init = (app) => {
    app.get('/api/v1/templates/taskType', ctrl.getTaskTypeTemplate);
    app.put('/api/v1/templates/taskType', companyAdmin, ctrl.updateTaskTypeTemplate);
    app.post('/api/v1/templates/taskType', companyAdmin, ctrl.insertTaskTypeTemplate);
    app.delete('/api/v1/templates/taskType/:id', companyAdmin, ctrl.deleteTaskTypeTemplate);

    app.get('/api/v1/templates/taskStatus', ctrlTaskStatus.getTaskStatusTemplate);
    app.put('/api/v1/templates/taskStatus', companyAdmin, ctrlTaskStatus.updateTaskStatusTemplate);
    app.post('/api/v1/templates/taskStatus', companyAdmin, ctrlTaskStatus.insertTaskStatusTemplate);
    app.delete('/api/v1/templates/taskStatus/:id', companyAdmin, ctrlTaskStatus.deleteTaskStatusTemplate);

    app.put('/api/v1/setting/taskType', companyAdmin, ctrlTaskTypeSetting.updateTaskTypeSettingTemplate);
    app.put('/api/v1/setting/taskStatus', companyAdmin, ctrlTaskStatusSetting.updateTaskStatusSettingTemplate);
    app.put('/api/v1/setting/projectStatus', companyAdmin, ctrlProjectStatusSetting.updateProjectStatusSettingTemplate);
    app.get('/api/v1/setting/projectStatus', ctrlProjectStatusSetting.getProjectStatus);
    app.get('/api/v1/setting/taskStatus', ctrlTaskStatusSetting.getTaskStatus);
    app.get('/api/v1/setting/taskType', ctrlTaskTypeSetting.getTaskTypes);
}

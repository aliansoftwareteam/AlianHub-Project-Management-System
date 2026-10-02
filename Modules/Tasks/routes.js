const {task} = require('./helpers/task_class');
const {taskMongo} = require('./helpers/task_class_Mongo');
const tabSyncTaskCtrl = require('./controller/getTabSyncTasks');
const everythingCtrl = require('./controller/everything');
const everythingViewsCtrl = require('./controller/everythingViews');
const advanceFilter = require('./helpers/manageGlobalFilter');
const getTaskCtrl = require('./helpers/getTasksData');
const { handleEvents } = require('../Company/eventController');
const logger = require('../../Config/loggerConfig');
const { requireTaskActionPermission, requireTaskWritePermission } = require('../../Config/permissionGuard');
const { TASK_ACTIONS, PRE_V2_TASK_ACTIONS, RELATION_ACTIONS, TASK_WRITE_ROUTES, actionEntry } = require('../../Config/taskWritePermissions');
const { TASK_ACTION_FIELDS, PRE_V2_ACTION_FIELDS, specFor, writtenTaskId, prepareOrRefuse, sendFailure } = require('./helpers/taskWriteFields');
const { importTargetAccess, refuseImport } = require('../Importers/helpers/importAccess');
const { taskPatchGuard, taskCreateGuard, relationGuard, agentsRefused } = require('../Agents/guard');

const agentRule = (fields) => taskPatchGuard((body) => writtenTaskId(fields, body));

/* Every route below prepares its request before it writes, and that answers "not found" for what the caller cannot open. */
const PREPARED = Object.freeze({ unopenableAsMissing: true });
const taskActionPermission = (actions) => requireTaskActionPermission(actions, PREPARED);
const taskWritePermission = (route) => requireTaskWritePermission(TASK_WRITE_ROUTES[route].entry, PREPARED);

exports.init = (app) => {
    app.patch('/api/tasks/', taskActionPermission(PRE_V2_TASK_ACTIONS), agentRule(PRE_V2_ACTION_FIELDS), async (req, res) => {
        const action = req.body && req.body.action;
        const payload = await prepareOrRefuse(req, res, specFor(PRE_V2_ACTION_FIELDS, action), `PATCH /api/tasks/ ${action}`);
        if (!payload) return;
        task[action](payload)
        .then((response) => {
            res.send({status: true, statusText: 'Task updated successfully.',data:response});
        })
        .catch((error) => {
            logger.error(`ERROR: ${error}`);
            sendFailure(res, error);
        });
    });

    app.post('/api/v2/tasks', taskWritePermission('POST /api/v2/tasks'), taskCreateGuard, async (req, res) => {
        try {
            const payload = await prepareOrRefuse(req, res, TASK_ACTION_FIELDS.create, 'create');
            if (!payload) return;
            taskMongo.create(payload)
            .then((resData) => {
                if(resData.status){
                    res.send({status: true, statusText: 'Task created successfully.', id: resData.id});
                }else{
                    res.send(resData);
                }
            })
            .catch((error) => {
                logger.error(`ERROR: ${error.message}`);
                sendFailure(res, error);
            });
        } catch (error) {
            logger.error(`ERROR: ${error.message}`);
            res.send({status: false, statusText: error.message});
        }
    });

    app.patch('/api/v2/tasks', taskActionPermission(TASK_ACTIONS), agentRule(TASK_ACTION_FIELDS), async (req, res) => {
        const action = req.body && req.body.action;
        const payload = await prepareOrRefuse(req, res, specFor(TASK_ACTION_FIELDS, action), action);
        if (!payload) return;
        taskMongo[action](payload)
        .then((response) => {
            // A handler that matched no document resolves {status:false}; without this the
            // envelope below would report a write that never happened as a success.
            if (response && response.status === false) {
                res.send(response);
                return;
            }
            res.send({status: true, statusText: 'Task updated successfully.',data:response});
        })
        .catch((error) => {
            logger.error(`ERROR: ${error}`);
            sendFailure(res, error);
        });
    });

    app.post('/api/v2/tasks/bulk', taskActionPermission(TASK_ACTIONS), async (req, res) => {
        try {
            const action = req.body && req.body.action;
            if (!action || typeof action !== 'string' || !action.startsWith('bulk')) {
                return res.send({ status: false, statusText: 'Invalid bulk action' });
            }
            if (typeof taskMongo[action] !== 'function') {
                return res.send({ status: false, statusText: `Unknown bulk action: ${action}` });
            }
            const payload = await prepareOrRefuse(req, res, specFor(TASK_ACTION_FIELDS, action), action);
            if (!payload) return;

            taskMongo[action](payload)
            .then((response) => {
                res.send({ status: true, statusText: 'Bulk operation completed', data: response });
            })
            .catch((error) => {
                logger.error(`ERROR bulk ${action}: ${error.message}`);
                sendFailure(res, error);
            });
        } catch (error) {
            logger.error(`ERROR bulk dispatch: ${error.message}`);
            res.send({ status: false, statusText: error.message });
        }
    });

    app.post('/api/v2/tasks/everything', everythingCtrl.listEverything);

    app.get('/api/v2/tasks/everything/views', everythingViewsCtrl.listViews);
    app.post('/api/v2/tasks/everything/views', everythingViewsCtrl.createView);
    app.patch('/api/v2/tasks/everything/views/:id', everythingViewsCtrl.updateView);
    app.delete('/api/v2/tasks/everything/views/:id', everythingViewsCtrl.deleteView);

    app.get('/api/v2/tasks/:id/lists', getTaskCtrl.getTaskLists);

    app.post('/api/v2/tasks/relations', taskActionPermission(RELATION_ACTIONS), relationGuard, async (req, res) => {
        try {
            const relation = actionEntry(RELATION_ACTIONS, req.body && req.body.action);
            if (!relation) {
                return res.send({ status: false, statusText: 'Invalid relation action' });
            }
            const { method } = relation;
            const payload = await prepareOrRefuse(req, res, specFor(TASK_ACTION_FIELDS, method), method);
            if (!payload) return;

            taskMongo[method](payload)
            .then((response) => {
                res.send(response);
            })
            .catch((error) => {
                logger.error(`ERROR relation ${req.body.action}: ${error.message}`);
                res.send({ status: false, statusText: error.message });
            });
        } catch (error) {
            logger.error(`ERROR relation dispatch: ${error.message}`);
            res.send({ status: false, statusText: error.message });
        }
    });

    app.patch('/api/v1/importTasks', agentsRefused('tasks.import'), taskWritePermission('PATCH /api/v1/importTasks'), async (req, res) => {
        const payload = await prepareOrRefuse(req, res, TASK_ACTION_FIELDS.createMultipleTasks, 'createMultipleTasks');
        if (!payload) return;
        const projectData = payload.projectData || {};
        importTargetAccess(projectData.CompanyId, String(req.uid || ''), { projectId: String(projectData._id || ''), sprintId: payload.sprint && payload.sprint.id })
        .then((target) => {
            if (!target.allowed) return refuseImport(res, target);
            return taskMongo.createMultipleTasks({ ...payload, sprint: target.sprint })
            .then((response) => {
                res.send({status: true, statusText: 'Task updated successfully.',data:response});
            });
        })
        .catch((error) => {
            console.error("ERRORsssss: ", error.message);
            res.send({status: false, statusText: error.message});
        });
    });
    
    app.post('/api/v1/tabSyncTask',tabSyncTaskCtrl.getTabSyncTasks);

    app.post('/api/v1/task/filter/create', advanceFilter.saveFilter);

    app.get('/api/v1/task/filter/:userId', advanceFilter.getFilter);

    app.put('/api/v1/task/filter/update', advanceFilter.updateFilter);

    app.delete('/api/v1/task/filter/delete/:cid/:id', advanceFilter.deleteFilter);

    app.get('/api/v1/task/:id',getTaskCtrl.getTask);

    app.post('/api/v1/task/find', getTaskCtrl.getTaskByQyery);

    app.put('/api/v1/task', agentsRefused('tasks.cascade'), getTaskCtrl.updateTask);

    app.get('/task-import/events/:id', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        handleEvents(req, res)
    });
}
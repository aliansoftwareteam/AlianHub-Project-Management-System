const {task} = require('./helpers/task_class');
const {taskMongo} = require('./helpers/task_class_Mongo');
const tabSyncTaskCtrl = require('./controller/getTabSyncTasks');
const advanceFilter = require('./helpers/manageGlobalFilter');
const getTaskCtrl = require('./helpers/getTasksData');
const { handleEvents } = require('../Company/eventController');
const logger = require('../../Config/loggerConfig');
const { requireTaskActionPermission, requireTaskWritePermission } = require('../../Config/permissionGuard');
const { TASK_ACTIONS, PRE_V2_TASK_ACTIONS, RELATION_ACTIONS, TASK_WRITE_ROUTES, actionEntry } = require('../../Config/taskWritePermissions');
const { TASK_ACTION_FIELDS, PRE_V2_ACTION_FIELDS, specFor, prepareOrRefuse, sendFailure } = require('./helpers/taskWriteFields');

exports.init = (app) => {
    app.patch('/api/tasks/', requireTaskActionPermission(PRE_V2_TASK_ACTIONS), async (req, res) => {
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

    app.post('/api/v2/tasks', requireTaskWritePermission(TASK_WRITE_ROUTES['POST /api/v2/tasks'].entry), async (req, res) => {
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
                res.send({status: false, statusText: error.message});
            });
        } catch (error) {
            logger.error(`ERROR: ${error.message}`);
            res.send({status: false, statusText: error.message});
        }
    });

    app.patch('/api/v2/tasks', requireTaskActionPermission(), async (req, res) => {
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

    app.post('/api/v2/tasks/bulk', requireTaskActionPermission(TASK_ACTIONS), async (req, res) => {
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
                res.send({ status: false, statusText: error.message });
            });
        } catch (error) {
            logger.error(`ERROR bulk dispatch: ${error.message}`);
            res.send({ status: false, statusText: error.message });
        }
    });

    app.post('/api/v2/tasks/relations', requireTaskActionPermission(RELATION_ACTIONS), async (req, res) => {
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

    app.patch('/api/v1/importTasks', requireTaskWritePermission(TASK_WRITE_ROUTES['PATCH /api/v1/importTasks'].entry), async (req, res) => {
        const payload = await prepareOrRefuse(req, res, TASK_ACTION_FIELDS.createMultipleTasks, 'createMultipleTasks');
        if (!payload) return;
        taskMongo.createMultipleTasks(payload)
        .then((response) => {
            res.send({status: true, statusText: 'Task updated successfully.',data:response});
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

    app.put('/api/v1/task', getTaskCtrl.updateTask);

    app.get('/task-import/events/:id', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        handleEvents(req, res)
    });
}
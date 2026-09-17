const {task} = require('./helpers/task_class');
const {taskMongo} = require('./helpers/task_class_Mongo');
const tabSyncTaskCtrl = require('./controller/getTabSyncTasks');
const advanceFilter = require('./helpers/manageGlobalFilter');
const getTaskCtrl = require('./helpers/getTasksData');
const { handleEvents } = require('../Company/eventController');
const logger = require('../../Config/loggerConfig');
const { requireTaskActionPermission, requireTaskWritePermission } = require('../../Config/permissionGuard');
const { TASK_ACTIONS, PRE_V2_TASK_ACTIONS, RELATION_ACTIONS, TASK_WRITE_ROUTES, actionEntry } = require('../../Config/taskWritePermissions');

exports.init = (app) => {
    app.post('/api/tasks', requireTaskWritePermission(TASK_WRITE_ROUTES['POST /api/tasks'].entry), (req, res) => {
        try {
            task.create(req.body)
            .then(() => {
                res.send({status: true, statusText: 'Task created successfully.'});
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

    app.patch('/api/tasks/', requireTaskActionPermission(PRE_V2_TASK_ACTIONS), (req, res) => {
        task[req.body.action](req.body)
        .then((response) => {
            res.send({status: true, statusText: 'Task updated successfully.',data:response});
        })
        .catch((error) => {
            logger.error(`ERROR: ${error}`);
            res.send({status: false, statusText: error.message});
        });
    });

    app.post('/api/v2/tasks', requireTaskWritePermission(TASK_WRITE_ROUTES['POST /api/v2/tasks'].entry), (req, res) => {
        try {
            taskMongo.create(req.body)
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

    app.patch('/api/v2/tasks', requireTaskActionPermission(), (req, res) => {
        taskMongo[req.body.action](req.body)
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
            res.send({status: false, statusText: error.message});
        });
    });

    // CompanyId comes from the verified header; it overrides anything the client put in the body to prevent spoofing.
    app.post('/api/v2/tasks/bulk', requireTaskActionPermission(TASK_ACTIONS), (req, res) => {
        try {
            const action = req.body && req.body.action;
            if (!action || typeof action !== 'string' || !action.startsWith('bulk')) {
                return res.send({ status: false, statusText: 'Invalid bulk action' });
            }
            if (typeof taskMongo[action] !== 'function') {
                return res.send({ status: false, statusText: `Unknown bulk action: ${action}` });
            }
            const headerCompanyId = req.headers['companyid'] || '';
            const payload = { ...req.body, companyId: headerCompanyId };

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

    app.post('/api/v2/tasks/relations', requireTaskActionPermission(RELATION_ACTIONS), (req, res) => {
        try {
            const relation = actionEntry(RELATION_ACTIONS, req.body && req.body.action);
            if (!relation) {
                return res.send({ status: false, statusText: 'Invalid relation action' });
            }
            const { method } = relation;
            const headerCompanyId = req.headers['companyid'] || '';
            const payload = { ...req.body, companyId: headerCompanyId };

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

    app.patch('/api/v1/importTasks', requireTaskWritePermission(TASK_WRITE_ROUTES['PATCH /api/v1/importTasks'].entry), (req, res) => {
        taskMongo.createMultipleTasks(req.body)
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
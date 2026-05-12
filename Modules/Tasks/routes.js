const {task} = require('./helpers/task_class');
const {taskMongo} = require('./helpers/task_class_Mongo');
const tabSyncTaskCtrl = require('./controller/getTabSyncTasks');
const advanceFilter = require('./helpers/manageGlobalFilter');
const getTaskCtrl = require('./helpers/getTasksData');
const { handleEvents } = require('../Company/eventController');

exports.init = (app) => {
    app.post('/api/tasks', (req, res) => {
        try {
            task.create(req.body)
            .then(() => {
                res.send({status: true, statusText: 'Task created successfully.'});
            })
            .catch((error) => {
                console.log('ERROR: ', error.message);
                res.send({status: false, statusText: error.message});
            });
        } catch (error) {
            console.log('ERROR: ', error.message);
            res.send({status: false, statusText: error.message});
        }
    });

    app.patch('/api/tasks/', (req, res) => {
        task[req.body.action](req.body)
        .then((response) => {
            res.send({status: true, statusText: 'Task updated successfully.',data:response});
        })
        .catch((error) => {
            console.log('ERROR: ', error);
            console.error("ERRORsssss: ", error.message);
            res.send({status: false, statusText: error.message});
        });
    });

    app.post('/api/v2/tasks', (req, res) => {
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
                console.log('ERROR: ', error.message);
                res.send({status: false, statusText: error.message});
            });
        } catch (error) {
            console.log('ERROR: ', error.message);
            res.send({status: false, statusText: error.message});
        }
    });

    app.patch('/api/v2/tasks', (req, res) => {
        taskMongo[req.body.action](req.body)
        .then((response) => {
            res.send({status: true, statusText: 'Task updated successfully.',data:response});
        })
        .catch((error) => {
            console.log('ERROR: ', error);
            console.error("ERRORsssss: ", error.message);
            res.send({status: false, statusText: error.message});
        });
    });

    app.patch('/api/v1/importTasks', (req, res) => {
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

    app.put('/api/v1/task',getTaskCtrl.updateTask);

    app.get('/task-import/events/:id', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        handleEvents(req, res)
    });
}
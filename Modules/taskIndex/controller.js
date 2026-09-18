
const { default: mongoose } = require("mongoose");
const { dbCollections } = require("../../Config/collections");
const logger = require("../../Config/loggerConfig");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { getCompanyDataFun } = require("../Company/controller/updateCompany");
const socketEmitter = require("../../event/socketEventEmitter");
const { pinSessionTenant } = require("../../Config/tenant");
const { keepTabMarkerOnly } = require("./helpers/updateMarker");
const { TASK_INDEX_FIELDS, TASK_INDEX_ONLOAD_FIELDS, prepareOrRefuse } = require("../Tasks/helpers/taskWriteFields");

const projectQueues = {};
const processingProjects = new Set();
/**
 * Update TaskIndex Of Task For Drag And Drop
 * @param {Objcet} 
 */
exports.updateTaskIndex = async (req,res) => {
    try {
        if (!pinSessionTenant(req, res)) return;
        const payload = await prepareOrRefuse(req, res, TASK_INDEX_FIELDS, 'taskIndex');
        if (!payload) return;
        req.body = payload;
        if (!req.body&& req.body.isFirst === undefined) {
            res.send({
                status: false,
                statusText: `isFirst is required`
            })
        }
        if (!req.body&& req.body.isFirstWithRecord === undefined) {
            res.send({
                status: false,
                statusText: `isFirstWithRecord is required`
            })
        }
        if (!(req.body && req.body.taskId)) {
            res.send({
                status: false,
                statusText: `taskId is required`
            })
        }
        if (!(req.body && req.body.projectId)) {
            res.send({
                status: false,
                statusText: `projectId is required`
            })
        }
        if (!(req.body && req.body.sprintId)) {
            res.send({
                status: false,
                statusText: `sprintId is required`
            })
        }
        if (!req.body&& req.body.relevantIndex === undefined) {
            res.send({
                status: false,
                statusText: `relevantIndex is required`
            })
        }
        if (!req.body&& req.body.indexName === undefined) {
            res.send({
                status: false,
                statusText: `indexName is required`
            })
        }
        if (!req.body&& req.body.relevantKey === undefined) {
            res.send({
                status: false,
                statusText: `relevantKey is required`
            })
        }
        if (!req.body&& req.body.searchKey === undefined) {
            res.send({
                status: false,
                statusText: `searchKey is required`
            })
        }
        if (!req.body&& req.body.taskKey === undefined) {
            res.send({
                status: false,
                statusText: `taskKey is required`
            })
        }
        if (!req.body&& req.body.updateData === undefined) {
            res.send({
                status: false,
                statusText: `updateData is required`
            })
        }
        let taskData = {
            relevantIndex: req.body.relevantIndex,
            projectId: req.body.projectId,
            companyId: req.body.companyId,
            taskId: req.body.taskId,
            isFirst: req.body.isFirst,
            indexName: req.body.indexName,
            sprintId: req.body.sprintId,
            relevantKey: req.body.relevantKey,
            searchKey: req.body.searchKey,
            taskKey: req.body.taskKey,
            isFirstWithRecord: req.body.isFirstWithRecord,
            updateData: keepTabMarkerOnly(req.body.updateData),
            isTaskUpdate: true,
        }
        enqueueTask(req.body.projectId, taskData);
        processQueue();
        res.send({
            status: true,
            statusText: `Process Is Start For Index`
        })
    } catch (error) {
        logger.error(`Error While Update Task Index API:${error}`);
    }
}      

 /**
 * Enquee A task
 * @param {String} ProjectId - ProjectId For Which Enquee A task.
 * @param {Object} TaskData - Task Object
*/
function enqueueTask(projectId, taskData) {
    if (!projectQueues[projectId]) {
        projectQueues[projectId] = [];
    }
    projectQueues[projectId].push(taskData);
}

/**
 * Process A Queue task
*/
function processQueue() {
    for (const projectId in projectQueues) {
        if (!processingProjects.has(projectId)) {
            processNextTask(projectId);
        }
    }
}


 /**
 * Process A Next Task
 * @param {String} ProjectId - ProjectId For Process Next Task.
*/
function processNextTask(projectId) {
    const projectQueue = projectQueues[projectId];
    if (!(projectQueue && projectQueue.length > 0)) return;
    processingProjects.add(projectId);
    const taskData = projectQueue.shift();
    exports.processTask(projectId, taskData)
        .catch((error) => {
            logger.error(`Error While Update Kanban Index of Project : ${projectId} TasKId: ${taskData.taskId} ::: Erorr => ${error}`);
        })
        .finally(() => {
            processingProjects.delete(projectId);
            processNextTask(projectId);
        });
}


 /**
 * Process A Task For Updating Index of Task
 * @param {String} ProjectId - ProjectId For Process Next Task.
 * @param {Object} TaskData - Task Object
*/
exports.processTask = async (projectId, taskData) => {
    const project = new mongoose.Types.ObjectId(projectId);
    const scope = { [taskData.searchKey]: taskData.relevantKey };
    let match;
    let sort;
    if (taskData.isFirst && !taskData.isFirstWithRecord) {
        match = [scope, { ProjectID: project }, { [taskData.indexName]: { $exists: true } }, { TaskKey: { $ne: taskData.taskKey } }];
        sort = 1;
    } else if (taskData.isFirst && taskData.isFirstWithRecord) {
        match = [scope, { [taskData.indexName]: { $lt: taskData.relevantIndex } }, { ProjectID: project }, { [taskData.indexName]: { $exists: true } }, { TaskKey: { $ne: taskData.taskKey } }];
        sort = -1;
    } else {
        match = [scope, { [taskData.indexName]: { $gt: taskData.relevantIndex } }, { ProjectID: project }, { [taskData.indexName]: { $exists: true } }, { TaskKey: { $ne: taskData.taskKey } }];
        sort = 1;
    }
    const object = {
        type: dbCollections.TASKS,
        data: [[{ $match: { $and: match } }, { $sort: { [taskData.indexName]: sort } }, { $limit: 1 }]],
    };
    const task = await MongoDbCrudOpration(taskData.companyId, object, 'aggregate');

    let newIndex;
    if (task.length) {
        newIndex = taskData.isFirst && !taskData.isFirstWithRecord ? (task[0][taskData.indexName] || 0) - 65536 : (task[0][taskData.indexName] + taskData.relevantIndex) / 2;
    } else if (taskData.isFirst && !taskData.isFirstWithRecord) {
        newIndex = 0;
    } else if (taskData.isFirst && taskData.isFirstWithRecord) {
        newIndex = taskData.relevantIndex - 65536;
    } else {
        newIndex = taskData.relevantIndex + 65536;
    }

    const update = taskData.isTaskUpdate ? { [taskData.indexName]: newIndex, ...taskData.updateData } : { [taskData.indexName]: newIndex };
    if (taskData.isTaskUpdate && taskData.indexName == "groupByDueDateIndex") {
        update.DueDate = update.DueDate ? new Date(update.DueDate) : null;
    }
    const upobj = {
        type: dbCollections.TASKS,
        data: [{ _id: taskData.taskId }, update, { returnDocument: 'after' }],
    };
    const result = await MongoDbCrudOpration(taskData.companyId, upobj, "findOneAndUpdate");
    if (!result) return;
    socketEmitter.emit('update', { type: "update", data: result, updatedFields: { [taskData.indexName]: result[taskData.indexName] }, module: 'task' });
}



/**
 * Create Task Index When Board view is load and Index is not there in Task
 * @param {Objcet} req
 * @param {Object} res
 * @returns
 */
exports.updateTaskIndexWhenLoad = async (req,res) => {
    try {
        if(!(req.body && req.body.taskUpdate)) {
            res.send(({
                status: false,
                statusText: `Task Update Is Required`
            }))
            return;
        }
        if (!pinSessionTenant(req, res)) return;
        const payload = await prepareOrRefuse(req, res, TASK_INDEX_ONLOAD_FIELDS, 'updateTaskIndexOnload');
        if (!payload) return;
        req.body = payload;
        let obj = {
            type: dbCollections.TASKS,
            data: [
                {
                    _id: req.body.taskUpdate.data
                }
            ]
        }
        MongoDbCrudOpration(req.body.companyId,obj,"findOne").then((rep)=>{
            if (!rep) {
                res.status(404).send({ status: false, statusText: 'Task not found' });
                return;
            }
            if (rep[req.body.taskUpdate.item.indexName] === undefined || rep[req.body.taskUpdate.item.indexName] === null) {
                if (req.body.taskUpdate.item.searchKey === "AssigneeUserId" && req.body.taskUpdate.item.searchValue == "[]") {
                    let taskObj = [
                        {
                          $match: {
                            ProjectID: rep.ProjectID,
                            TaskKey: {$ne: rep.TaskKey},
                            [req.body.taskUpdate.item.indexName]: { $exists: true },
                            // sprintId: rep.sprintId,
                            AssigneeUserId: { $size: 0 }
                          }
                        },
                        { $sort: { [req.body.taskUpdate.item.indexName]: 1 } },
                        {
                          $group: {
                            _id: "$AssigneeUserId",
                            count: { $sum: 1 },
                            results: { $push: "$$ROOT" }
                          }
                        },
                        { $limit: 1 }
                    ]
                    let objSh = {
                        type: SCHEMA_TYPE.TASKS,
                        data: [taskObj]
                    }
                    MongoDbCrudOpration(req.body.companyId, objSh, 'aggregate').then((resp)=>{
                        if (resp && resp[0].results && resp[0].results.length) {
                            exports.updateIndex(req.body.taskUpdate,req.body.companyId,rep,resp[0].results[0]).then((response)=>{
                                res.send(response)
                            }).catch((error)=>{
                                res.send(error)
                            })
                        } else {
                            exports.update0Index(req.body.taskUpdate,req.body.companyId,rep).then((response)=>{
                                res.send(response)
                            }).catch((error)=>{
                                res.send(error)
                            })
                        }
                    }).catch((error)=>{
                        res.send({
                            status: false,
                            statusText: `Error Get GroupBy: ${error}`
                        })
                    })
                } else {
                    let object = {
                        type: dbCollections.TASKS,
                        data: [[
                            {
                                $match: {
                                    $and: [
                                        {[req.body.taskUpdate.item.indexName]: {$exists: true}},
                                        { [req.body.taskUpdate.item.searchKey]: req.body.taskUpdate.item.searchValue },
                                        { "ProjectID": new mongoose.Types.ObjectId(rep.ProjectID) },
                                        // { "sprintId": rep.sprintId },
                                        { "TaskKey": { $ne: rep.TaskKey } },
                                    ]
                                }
                            },
                            { $sort: { [req.body.taskUpdate.item.indexName]: -1 } },
                            { $limit: 1 }
                        ]]
                    }
                    MongoDbCrudOpration(req.body.companyId,object,"aggregate").then((task) => {
                        if (task.length > 0) {
                            exports.updateIndex(req.body.taskUpdate,req.body.companyId,rep,task[0]).then((response)=>{
                                res.send(response)
                            }).catch((error)=>{
                                res.send(error)
                            })
                        } else {
                            exports.update0Index(req.body.taskUpdate,req.body.companyId,rep).then((response)=>{
                                res.send(response)
                            }).catch((error)=>{
                                res.send(error)
                            })
                        }
                    }).catch((error) => {
                        res.send({ status: false, statusText: `Error Get Neighbour: ${error.message}` });
                    })
                }
            } else {
                res.send({
                    status: true,
                    statusText: `No Need To Processs`
                })
            }
        }).catch((error)=>{
            res.send({
                status: true,
                statusText: `No Record Found::${error.message}`
            })
        })
    } catch (error) {
        res.send({ status: false, statusText: error.message });
    }
}



/**
 * Update 0 Index in task
 * @param {Object} TaskUpdate - Task Object In which Index is to be updated
 * @param {String} CompanyId - Company Id In which Task Is Created
 * @param {Object} Rep - Response Of Task Object Which is Get from Typsense
 * @returns {Promise<String>} A Promise that resolves with the status true if index update succesfully.
 *                            Rejects with an error message if any issues occur during the Update Process.
 */
exports.update0Index = (taskUpdate,companyId,rep) => {
    return new Promise((resolve, reject) => {
        try {
            let obj = {
                type: dbCollections.TASKS,
                data: [
                    {
                        _id: rep._id,
                    },
                    {
                        [taskUpdate.item.indexName]: 0
                    },
                    {
                        returnDocument: 'after'
                    }
                ]
            }
            MongoDbCrudOpration(companyId,obj,"findOneAndUpdate").then((result)=>{
                socketEmitter.emit('update', { type: "update", data: result , updatedFields: {[taskUpdate.item.indexName]: result[taskUpdate.item.indexName]} , module: 'task'});
                resolve({
                    status: true,
                    statusText: `Index Update Successfully`
                })
            }).catch((error)=>{
                reject({
                    status: false,
                    statusText: `Error: ${error}`
                })
            })
        } catch (error) {
            reject({
                status: false,
                statusText: `Error: ${error.message}`
            })
        }
    })
}




/**
 * Update Index in task
 * @param {Object} TaskUpdate - Task Object In which Index is to be updated
 * @param {String} CompanyId - Company Id In which Task Is Created
 * @param {Object} Rep - Response Of Task Object Which is Get from Typsense
 * @param {Object} TypsenseTask - We need to update the new task index from the task object referenced by this task index.
 * @returns {Promise<String>} A Promise that resolves with the status true if index update succesfully.
 *                            Rejects with an error message if any issues occur during the Update Process.
 */
exports.updateIndex = (taskUpdate,companyId,rep,typsenseTask) => {
    return new Promise((resolve, reject) => {
        try {
            if (typsenseTask[taskUpdate.item.indexName] !== undefined) {
                let obj = {
                    type: dbCollections.TASKS,
                    data: [
                        {
                            _id: rep._id,
                        },
                        {
                            [taskUpdate.item.indexName]: typsenseTask[taskUpdate.item.indexName] + 65536,
                        },
                        {
                            returnDocument: 'after'
                        }
                    ]
                }
                MongoDbCrudOpration(companyId,obj,"findOneAndUpdate").then((result)=>{
                    socketEmitter.emit('update', { type: "update", data: result , updatedFields: {[taskUpdate.item.indexName]: result[taskUpdate.item.indexName]}, module: 'task' });
                    resolve({
                        status: true,
                        statusText: `Index Update Successfully`
                    })
                }).catch((error)=>{
                    reject({
                        status: false,
                        statusText: `Error: ${error}`
                    })
                })
            } else {
                exports.update0Index(taskUpdate,companyId,rep).then((response)=>{
                    resolve(response)
                }).catch((error)=>{
                    reject({status: false, statusText: `Error: ${error.message}`});
                })
            }
        } catch (error) {
            reject({status: false, statusText: `Error: ${error.message}`});
        }
    })
}

/**
 * Crone For Update UnIndex Task
 */
exports.isCreateUnIndexTask = false;
exports.createUnIndexTask = () => {
    try {
        if (exports.isCreateUnIndexTask) {
            logger.info(`Crone createUnIndex task is running and it is skipped for this hour:: ${new Date().getHours()}`);
            return;
        }
        exports.isCreateUnIndexTask = true;
        let promises = [];

        getCompanyDataFun([],true).then((response) => {
            response.forEach((cmp) => {
                promises.push(exports.updateUnIndexTaskForCompanyWise(JSON.parse(JSON.stringify(cmp))._id))
            })
            Promise.allSettled(promises).then(() => {
                logger.info(`Crone createUnIndex task is completed for :${new Date().getHours()}`);
                exports.isCreateUnIndexTask = false;
            }).catch((error) => {
                logger.error(`createUnIndex task error: ${JSON.stringify(error)}`);
                exports.isCreateUnIndexTask = false;
            })
        })
    } catch (error) {
        exports.isCreateUnIndexTask = false;
        logger.error(`createUnIndex task try catch error: ${error}`);
    }
}


exports.updateUnIndexTaskForCompanyWise = (companyId) => {
    return new Promise((resolve, reject) => {
        try {
            let oneHourBeforeTime = new Date(new Date().setHours(new Date().getHours() - 1));
            let indexes = [
                {
                    indexName:'groupByDueDateIndex',
                    searchKey: 'DueDate',
                    group:1
                },
                {
                    indexName:'groupByPriorityIndex',
                    searchKey: 'Task_Priority',
                    group:2
                },
                {
                    indexName:'groupByStatusIndex',
                    searchKey: 'statusKey',
                    group:3
                },
                {
                    indexName:'groupByAssigneeIndex',
                    searchKey: 'AssigneeUserId',
                    group:4
                }
            ]
            let obj = {
                type: SCHEMA_TYPE.TASKS,
                data: [{
                    createdAt: {
                        $gt:  new Date(oneHourBeforeTime)
                    }
                }]
            }
            MongoDbCrudOpration(companyId,obj,"find").then((resp)=>{
                let count = 0;
                logger.info(`[CRON] FOUND TASKS FOR UPDATE INDEX FOR ${companyId}: ${resp.length}`)
                let countFunction = (row) => {
                    if (count >= resp.length) {
                        resolve();
                        return;
                    } else {
                        let remainingIndexs = indexes.filter((x) => !Object.keys(row).includes(x.indexName))
                        let innerCount = 0;
                        logger.info(`[CRON] FOUND TASKS FOR UPDATE INDEX FOR ${companyId}: REMAINING INDEXS >> ${remainingIndexs.length}`)
                        let innerCountFunction = (innerRow) => {
                            if (innerCount >= remainingIndexs.length) {
                                count++;
                                countFunction(resp[count]);
                                return;
                            } else {
                                let releventKey;
                                if (innerRow.group === 4) {
                                    if (row.AssigneeUserId.length === 0) {
                                        releventKey = [];
                                    } else {
                                        releventKey = row.AssigneeUserId.join("_");
                                    }
                                } else if (innerRow.group === 1 && row.DueDate !== null) {
                                    releventKey = row.DueDate ? Number(new Date(row.DueDate).getTime() / 1000) : null
                                } else {
                                    releventKey = row[innerRow.searchKey]
                                }
                                let taskData = {
                                    relevantIndex: 0,
                                    projectId: JSON.parse(JSON.stringify(row.ProjectID)),
                                    companyId: JSON.parse(JSON.stringify(row.CompanyId)),
                                    taskId: JSON.parse(JSON.stringify(row._id)),
                                    isFirst: true,
                                    indexName: innerRow.indexName,
                                    sprintId: row.sprintId,
                                    relevantKey: releventKey,
                                    searchKey: innerRow.searchKey,
                                    taskKey: row.TaskKey,
                                    isFirstWithRecord: false,
                                    updateData: {},
                                }
                                enqueueTask(row.ProjectID, taskData);
                                processQueue();
                                innerCount++;
                                innerCountFunction(remainingIndexs[innerCount]);
                            }
                        }
                        innerCountFunction(remainingIndexs[innerCount]);
                    }
                }
                countFunction(resp[count]);
            }).catch((error)=>{
                reject(error);
            })
        } catch (error) {
            reject(error);
        }
    })
}

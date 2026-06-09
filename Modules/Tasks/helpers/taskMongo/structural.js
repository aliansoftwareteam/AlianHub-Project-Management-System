const { dbCollections } = require('../../../../Config/collections')
const { sanitizeInput } = require("../../../serviceFunction");
const { HandleHistory,HandleTask,convertToSubTaskFunction, moveTaskFunction, convertToListSubTask,mergeSubTask, duplicateSubTaskFunction, addHistoryCollection, removeCommentCount,updateHistoryCollection, updateTimesheetCollection, updateEstimatedTimeCollection} = require("../mongo_helper")

const { createTask, taskAssigneeAdd, taskAssigneeRemove,taskAssigneeReplace, taskNameEdit, taskPriorityChange, taskStatusChange, taskAttachmentAdd, taskAttachmentRemove, taskTypeChage, taskTotalEstimate } = require('../notificationTemplate')
const { HandleBothNotification } = require("../handleNotification")
const logger = require("../../../../Config/loggerConfig")
const { addSprintFun, updateSprintFun } = require("../../../Sprints/controller")
const { SCHEMA_TYPE } = require('../../../../Config/schemaType');
const { MongoDbCrudOpration } = require("../../../../utils/mongo-handler/mongoQueries");
const { default: mongoose } = require("mongoose")
const { updateUnReadCommentsCountFun } = require("../../../notification-count/controller")
const { handleTaskAttachmentsDuplicateFunctionality } = require(`../../../../common-storage/common-${process.env.STORAGE_TYPE}.js`)
const { buildQueryObject, buildHistoryObject, convertToDisplayFormat } = require("../helper");
const socketEmitter = require('../../../../event/socketEventEmitter');
const { addCommentCollection, updateCommentCollection } = require('../../../Comments/controller')
const { updateMainChat } = require('../../../MainChats/controller');
const { replaceObjectKey } = require("../../../Auth/helper");
const { emitListener } = require("../../../Company/eventController.js");
const { createCustomFields } = require("../helper.js");
const { removeCache } = require('../../../../utils/commonFunctions.js');
const { updateRemainingTime } = require('../../../LogTime/controllerV2.js');
module.exports = {

    updateArchiveDelete({companyId, projectData, sprintId, task, userData, deletedStatusKey = 0}) {
        return new Promise((resolve, reject) => {
            try {
                const query = {
                    type: dbCollections.TASKS,
                    data: [
                        {
                            _id: new mongoose.Types.ObjectId(task._id)
                        }, {
                            $set: {
                                deletedStatusKey
                            },
                        }, {
                            returnDocument: 'after'
                        }
                    ]
                }
                MongoDbCrudOpration(companyId, query, "findOneAndUpdate")
                .then((result) => {
                    socketEmitter.emit('update', { type: "update", data: result , updatedFields: {deletedStatusKey}, module: 'task' });
                    try {
                        if(task?.ParentTaskId) {
                            if(!deletedStatusKey || (!task?.deletedStatusKey && deletedStatusKey) ) {
                                this.updateParentCount(
                                    companyId,
                                    task.ParentTaskId,
                                    !deletedStatusKey ? 1 : -1
                                );
                            }
                        }
                        if(task?.isParentTask) {
                            let filterBy = {ParentTaskId: task._id};
                            let taskDeleteStatusKey = 0;
                            if(!deletedStatusKey) {
                                filterBy = {...filterBy, deletedStatusKey :{$eq: 3}};
                                taskDeleteStatusKey = 0;
                            } else {
                                filterBy = {...filterBy, deletedStatusKey :{$eq: 0}};
                                if(deletedStatusKey === 2) {
                                    taskDeleteStatusKey = 3
                                } else if(deletedStatusKey === 1) {
                                    taskDeleteStatusKey = 1
                                }
                            }

                            const batchQyery = {
                                type: dbCollections.TASKS,
                                data: [
                                    {
                                        ...filterBy
                                    }, {
                                        $set: {
                                            deletedStatusKey: taskDeleteStatusKey
                                        },
                                    }
                                ]
                            }
                            MongoDbCrudOpration(companyId, batchQyery, "updateMany")
                            .catch((error) => {
                                logger.error(`ERORR in update parent count: ${error.message}`);
                            })

                            if(taskDeleteStatusKey !== 0) {
                                const countResetData = {
                                    companyId : companyId,
                                    projectId: projectData._id,
                                    userIds: [...(result.AssigneeUserId || [])],
                                    "read": true,
                                    key: 2,
                                    taskId: task._id,
                                    sprintId: sprintId
                                }
                                updateUnReadCommentsCountFun(countResetData)
                                .catch((error) => {
                                    logger.error(`ERORR in update parent count: ${error?.message}`);
                                })
                            }
                        }
                    } catch (error) {
                        logger.error(`ERORR in update parent count: ${error.message}`);
                    }
                    resolve({status: true, statusText: "deleteStatus updated successfully"});
                    let updateObject = {};

                    if(deletedStatusKey === 2) {
                        updateObject = { $inc: { archiveTaskCount : task.isParentTask ? (task.subTasks || 0) + 1 : 1, tasks : task.isParentTask ? -1 * ((task.subTasks || 0) + 1) : -1} }
                    } else if (deletedStatusKey === 0) {
                        updateObject= { $inc: { archiveTaskCount: task.isParentTask ? -1 * ((task.subTasks || 0) + 1) : -1, tasks : task.isParentTask ? (task.subTasks || 0) + 1 : 1}
                        }
                    } else if (deletedStatusKey === 1) {
                        if(task.deletedStatusKey === 2){
                            updateObject= { $inc: { archiveTaskCount: task.isParentTask ? -1 * ((task.subTasks || 0) + 1) : -1} }
                        }else{
                            updateObject= { $inc: { tasks : task.isParentTask ? -1 * ((task.subTasks || 0) + 1) : -1} }
                        }
                    }
                    const countObj = {
                        body: {
                            companyId: companyId,
                            projectId: projectData._id,
                            updateObject :updateObject
                        },
                        params : {
                            id : sprintId
                        }
                    }
                    if(task.folderObjId){
                        countObj.body.folder = {
                            folderId: task.folderObjId,
                            folderName: task.sprintArray.folderName || ""
                        }
                    }

                    updateSprintFun(countObj).catch((error) => {
                        logger.error(`error in update task count : ${error}`)
                    });
                    removeCommentCount(companyId,task.ProjectID,task.sprintId,task._id,task.ParentTaskId).catch((error) => {
                        logger.error(`${error} ERROR IN REMOVE COMMENT COUNT`);
                    })

                    if(task?.subTasks > 0){
                        let data = [
                            {
                                isParentTask: false,
                                ParentTaskId: task._id
                            }
                        ]
                        MongoDbCrudOpration(companyId, {type: dbCollections.TASKS,data: data}, "find").then(async(result) => {
                            result.forEach((subTask) => {
                                removeCommentCount(companyId,subTask.ProjectID,subTask.sprintId,subTask._id).catch((error) => {
                                    logger.error(`${error} ERROR IN REMOVE COMMENT COUNT`);
                                })
                            })
                        })
                    }

                    try {
                        let historyObj = {
                            message: `<b>${userData.Employee_Name}</b> has ${deletedStatusKey === 0 ? 'restored' : deletedStatusKey === 1 ? 'deleted' : 'archieved'} <b>${sanitizeInput(task.TaskName)}</b> task in <b>${sanitizeInput(projectData.ProjectName)}</b> project.`,
                            key: "task_delete",
                            sprintId: task.sprintId,
                        }

                        let notificationObject = {
                            'type': 'task',
                            'key': 'task_delete',
                            'message': `<strong>${userData.Employee_Name}</strong> has ${deletedStatusKey === 0 ? 'restored' : deletedStatusKey === 1 ? 'deleted' : 'archieved'} <strong>${sanitizeInput(task.TaskName)}</strong> task in <strong>${sanitizeInput(projectData.ProjectName)}</strong> project.`,
                        }

                        if(historyObj && Object.keys(historyObj).length) {
                            HandleHistory('task', companyId, projectData._id, task._id, historyObj, userData)
                            .catch((error) => {
                                logger.error(`ERROR in history: ${error.message}`);
                            });
                            HandleHistory('project', companyId, projectData._id, null, historyObj, userData)
                            .catch((error) => {
                                logger.error(`ERROR in history: ${error.message}`);
                            });
                        }
                        if(notificationObject && Object.keys(notificationObject).length) {
                            HandleBothNotification({type: 'tasks', companyId, projectId: projectData._id, taskId: task._id, folderId: task?.folderObjId || '', sprintId: task?.sprintId || '',  object: notificationObject, userData})
                            .catch((error) => {
                                logger.error(`ERROR in add notification: ${error.message}`);
                            })
                        }
                    } catch(error) {
                        logger.error(`ERROR: ${error.message}`);
                    }
                })
                .catch((error) => {
                    logger.error(`Archive Delete Error:${error.message}`)
                    reject(error);
                })
            } catch (error) {
                logger.error(`Archive Delete Error:${error.message}`)
                reject(error);
            }
        })
    },

    convertToSubTask({companyId, projectData, sprintId,selectedTaskId, taskId,oldProject,isSubTask,userData}) {
        return new Promise(async(resolve, reject) => {
            let convertTaskArray = [];
            let isMainSubTask = false;
            let object = {
                type: dbCollections.TASKS,
                data: [{ _id : new mongoose.Types.ObjectId(selectedTaskId)}]
            }
            await MongoDbCrudOpration(companyId,object, "findOne").then(async(tasData) => {
                if(tasData.isParentTask === false) {
                    isMainSubTask = true;
                }
                convertTaskArray.push(tasData);
                let subTasks = []
                if(isSubTask === true){
                    let data = [
                        {
                            ProjectID : new mongoose.Types.ObjectId(oldProject.id),
                            sprintId: new mongoose.Types.ObjectId(tasData.sprintId),
                            isParentTask: false,
                            ParentTaskId: selectedTaskId,
                            deletedStatusKey: { $nin: [1] }
                        }
                    ]
                    await MongoDbCrudOpration(companyId, {type: dbCollections.TASKS,data: data}, "find").then((result) => {
                        subTasks = result;
                    })
                }
                convertTaskArray = convertTaskArray.concat(subTasks);
                let object = {
                    type: dbCollections.TASKS,
                    data: [{ _id : taskId}]
                }
                await MongoDbCrudOpration(companyId,object, "findOne").then((task) => {
                    let promisesArr = [];
                    convertTaskArray.forEach((ctask) => {
                        promisesArr.push(
                            new Promise(async(resolve1, reject1) => {
                                try {
                                    convertToSubTaskFunction(companyId, projectData, sprintId, ctask,task,oldProject,isMainSubTask,isSubTask,userData).then((response) => {
                                        resolve1();
                                    }).catch((error) => {
                                        logger.error(`ERROR IN CONVERT TO SUBTASK FUNCTION ${error}`)
                                        reject1(error);
                                    })
                                } catch (error) {
                                    reject1(error)
                                }
                            })
                        )
                    })
                    Promise.allSettled(promisesArr).then(() => {
                        resolve({status: true, statusText: "Convert to task successfully",sprintCount: convertTaskArray.length});
                    }).catch((error) => {
                        reject(error);
                    })
                })
            })
        }) 
    },

    moveTask({companyId, projectData, sprintObj,moveTaskId ,oldSprintObj,oldProject,isSubTask,assignee,watcher,userData}) {
        try {
            return new Promise((resolve, reject) => {
                let moveTaskArray = [];
                let object = {
                    type: dbCollections.TASKS,
                    data: [
                        {
                            _id : moveTaskId
                        }
                    ]
                }
                MongoDbCrudOpration(companyId,object, "findOne").then(async(move) => {
                    moveTaskArray.push(move);
                    let subMove = [];
                    if(isSubTask === true){
                        let data = [
                            {
                                ProjectID : new mongoose.Types.ObjectId(oldProject.id),
                                sprintId: new mongoose.Types.ObjectId(move.sprintId),
                                isParentTask:false,
                                ParentTaskId:moveTaskId,
                                deletedStatusKey: { $nin: [1] }
                            }
                        ]
                        await MongoDbCrudOpration(companyId, {type: dbCollections.TASKS,data: data}, "find").then((result) => {
                            result.filter((x)=>{
                                subMove.push(x);
                            })
                        })
                    }
                    moveTaskArray = moveTaskArray.concat(subMove);
                    let promisesArr = [];
                    moveTaskArray.forEach((moveTask) => {
                        promisesArr.push(
                            new Promise(async(resolve1, reject1) => {
                                try {
                                    moveTaskFunction(companyId, projectData, sprintObj, moveTask,oldSprintObj,oldProject,assignee,watcher,userData,isSubTask).then(() => {
                                        if(JSON.parse(JSON.stringify(moveTask))?.ProjectID !== projectData.id){
                                            let indexObj = {
                                                indexName : "groupByStatusIndex",
                                                searchKey : "statusKey",
                                                searchValue : "1"
                                            }
                                            this.updateTaskKey({
                                                companyId: companyId,
                                                projectCode: projectData.ProjectCode,
                                                projectId: projectData.id,
                                                taskId: moveTask._id,
                                                taskTypeKey: moveTask.TaskTypeKey,
                                                sprintId: sprintObj.id,
                                                isParentTask:true,
                                                indexObj:indexObj
                                            })
                                        }
                                        resolve1();
                                    }).catch((error) => {
                                        logger.error(`ERROR IN MOVE FUNCTION ${error}`)
                                        reject1(error);
                                    })
                                } catch (error) {
                                    reject1(error)
                                }
                            })
                        )
                    })
                    Promise.allSettled(promisesArr).then(() => {
                        resolve({status: true, statusText: "move Task successfully",sprintCount: moveTaskArray.length});
                    }).catch((error) => {
                        reject(error);
                    })
                })
            }) 
        } catch (error) {
            logger.error(`${error} Error in move task.`)
        }
    },

    convertToList({companyId, projectData, taskId, userData, folderData, sprintObj, isSubTask}) {
        return new Promise((resolve, reject) => {
            try {
                const schema = SCHEMA_TYPE.TASKS
                let obj = {
                    type: schema,
                    data: [
                        {
                            _id: new mongoose.Types.ObjectId(taskId)
                        }
                    ]
                }

                MongoDbCrudOpration(companyId, obj, "findOne").then((task) => {

                    let updateObj = {
                        type: schema,
                        data: [
                            { _id: new mongoose.Types.ObjectId(taskId) },
                            { $set: { deletedStatusKey: 1 } },
                            { upsert: true, returnDocument: 'after' }
                        ]
                    }

                    MongoDbCrudOpration(companyId, updateObj, "findOneAndUpdate").then((result)=>{
                        socketEmitter.emit('update', { type: "update", data: result , updatedFields: { deletedStatusKey: 1 }, module: 'task' });
                    })

                    const addObj = {
                        body: {
                            companyId: companyId,
                            projectId: projectData.id,
                            sprintName: task.TaskName,
                            userData: userData,
                            projectName: projectData.ProjectName,
                            from: "task",
                            taskSprintObj : {
                                taskSprintName : task.sprintArray.name,
                                taskFodlerName : task.sprintArray.folderName
                            }
                        }
                    }
                    if(folderData && Object.keys(folderData).length > 0){
                        addObj.body.folder = {
                            folderId: folderData.folderId,
                            folderName: folderData.name
                        }
                    }

                    addSprintFun(addObj).then((res) => {
                        resolve({status: true, statusText: "Sprint added successfully", data: res.data});

                        const decObj = {
                            body: {
                                companyId: companyId,
                                projectId: projectData.id,
                                folderId: task?.folderObjId || null,
                                updateObject :{$inc: { tasks: -1}},
                                folderId: sprintObj?.folderId || null,
                            },
                            params : {
                                id : task.sprintId
                            }
                        }
                        updateSprintFun(decObj).catch((error) => {
                            logger.error(`error in update task count : ${error}`)
                        });
                        removeCommentCount(companyId,task.ProjectID,task.sprintId,task._id,task.ParentTaskId).catch((error) => {
                            logger.error(`${error} ERROR IN REMOVE COMMENT COUNT`);
                        })

                        if(task.isParentTask === false) {
                            let updateObj1 = {
                                type: schema,
                                data: [
                                    { _id: new mongoose.Types.ObjectId(task.ParentTaskId) },
                                    { $inc: { subTasks: -1 } },
                                    { upsert: true, returnDocument: 'after' }
                                ]
                            }
                            MongoDbCrudOpration(companyId, updateObj1, "findOneAndUpdate").then((result)=>{
                                socketEmitter.emit('update', { type: "update", data: result , updatedFields: {subTasks: result.subTasks}, module: 'task' });
                            })
                        }

                        let delObj = {
                            type: schema,
                            data: [
                                {
                                    _id: new mongoose.Types.ObjectId(task._id)
                                }
                            ]
                        }
                        MongoDbCrudOpration(companyId, delObj, "deleteOne");

                        if(isSubTask === true) {
                            let getdataObj = {
                                type: schema,
                                data: [
                                    {
                                        ParentTaskId: task._id,
                                        deletedStatusKey: { $nin: [1] }
                                    }
                                ]
                            }
                            MongoDbCrudOpration(companyId, getdataObj, "find").then((result) => {

                                let promisesArr = [];
                                result.forEach((subTask) => {
                                    promisesArr.push(
                                        new Promise(async(resolve1, reject1) => {
                                            try {
                                                convertToListSubTask(companyId, projectData, subTask, res.data, sprintObj).then(() => {
                                                    resolve1();
                                                }).catch((error) => {
                                                    logger.error(`ERROR IN CONVERT TO LIST FUNCTION ${error}`)
                                                    reject1(error);
                                                })
                                            } catch (error) {
                                                reject1(error)
                                            }
                                        })
                                    )
                                })
                                Promise.allSettled(promisesArr).then(() => {
                                    resolve({status: true, statusText: "Convert to list updated successfully"});
                                }).catch((error) => {
                                    reject(error);
                                })
                            });
                        }
                    })
                });
            } catch (error) {
                reject(error);
            }
        })
    },

    convertToTask({companyId,projectData,taskId,sprintObj,parentTaskId,oldSprintObj,oldProject}) {
        return new Promise((resolve, reject) => {
            try {
                let deleteObj = {
                    type: SCHEMA_TYPE.TASKS,
                    data: [
                        {
                            _id: new mongoose.Types.ObjectId(taskId)
                        },
                        {
                            $set: {deletedStatusKey : 1}
                        },
                        {
                            returnDocument: 'after'
                        }
                    ]
                }
                MongoDbCrudOpration(companyId, deleteObj, "findOneAndUpdate").then((result) => {
                    socketEmitter.emit('update', { type: "update", data: result , updatedFields: {deletedStatusKey : 1}, module: 'task' });
                    let object = {
                        type: dbCollections.TASKS,
                        data: [
                            {
                                _id : new mongoose.Types.ObjectId(taskId)
                            }
                        ]
                    }
                    MongoDbCrudOpration(companyId,object, "findOne").then((task) => {
                        let obj = {};
                        let unsetObj = {};
                        if(projectData.id !== oldProject.id) {
                            let Ind = oldProject.taskStatusData.findIndex((x) => {return x.key === task.statusKey});
                            let typeInd = oldProject.taskTypeCounts.findIndex((x) => {return x.value === task.TaskType});
                            let statusData = oldProject.taskStatusData[Ind];
                            let typeData = oldProject.taskTypeCounts[typeInd];
                            obj = {
                                isParentTask : true,
                                ParentTaskId : '',
                                sprintId : sprintObj.id,
                                sprintArray : sprintObj,
                                status:{
                                    key:statusData.convertStatus.key,
                                    value:'',
                                    text: statusData.convertStatus.name,
                                    type: statusData.convertStatus.type
                                },
                                statusType: statusData.convertStatus.type,
                                statusKey: statusData.convertStatus.key,
                                TaskType: typeData.convertType.value,
                                TaskTypeKey: typeData.convertType.key,
                                ProjectID : projectData.id,
                                deletedStatusKey : 0,
                            }
                            if(sprintObj.folderId){
                                obj.folderObjId = sprintObj.folderId;
                            }else{
                                if(task.folderObjId){
                                    unsetObj = {
                                        folderObjId:''
                                    }
                                    delete task.folderObjId;
                                }
                            }
                        }else{
                            obj = {
                                isParentTask : true,
                                ParentTaskId : '',
                                sprintId : sprintObj.id,
                                sprintArray : sprintObj,
                                deletedStatusKey : 0,
                            }
                            if(sprintObj.folderId){
                                obj.folderObjId = sprintObj.folderId;
                            }else{
                                if(task.folderObjId){
                                    unsetObj = {
                                        folderObjId:''
                                    }
                                    delete task.folderObjId;
                                }
                            }
                        }
                        let queryObj = {
                            type: SCHEMA_TYPE.TASKS,
                            data: [
                                {
                                    _id: new mongoose.Types.ObjectId(taskId)
                                },
                                {
                                    $set: {...obj},
                                    $unset: unsetObj
                                },
                                {
                                    returnDocument: 'after'
                                }
                            ]
                        }
                        MongoDbCrudOpration(companyId, queryObj, "findOneAndUpdate").then((result) => {
                            socketEmitter.emit('update', { type: "update", data: result , updatedFields: {...obj,folderId: ''}, module: 'task' });
                            let object = {
                                type:SCHEMA_TYPE.TASKS,
                                data: [
                                    { _id: new mongoose.Types.ObjectId(parentTaskId) },
                                    {$inc: {"subTasks": -1}},
                                    {returnDocument: 'after'}
                                ]
                            }
                            MongoDbCrudOpration(companyId, object, "findOneAndUpdate").then((response) => {
                                socketEmitter.emit('update', { type: "update", data: response , updatedFields: {subTasks: response.subTask}, module: 'task' });
                                resolve({status: true, statusText: "Convert TO Task"});
                                if(oldSprintObj.id !== sprintObj.id || JSON.parse(JSON.stringify(oldProject)).id !== JSON.parse(JSON.stringify(projectData)).id){
                                    const decObj = {
                                        body: {
                                            companyId: companyId,
                                            projectId: oldProject.id,
                                            folderId: oldSprintObj?.folderId || null,
                                            updateObject :{$inc: { tasks: -1}},
                                        },
                                        params : {
                                            id : oldSprintObj.id
                                        }
                                    }
                                    updateSprintFun(decObj).catch((error) => {
                                        logger.error(`error in update task count : ${error}`)
                                    });
                                    const incObj = {
                                        body: {
                                            companyId: companyId,
                                            projectId: projectData.id,
                                            folderId: sprintObj?.folderId || null,
                                            updateObject :{$inc: { tasks: 1}},
                                        },
                                        params : {
                                            id : sprintObj.id
                                        }
                                    }
                                    updateSprintFun(incObj).catch((error) => {
                                        logger.error(`error in update task count : ${error}`)
                                    });
                                }
                                removeCommentCount(companyId,task.ProjectID,task.sprintId,task._id,task.ParentTaskId).catch((error) => {
                                    logger.error(`${error} ERROR IN REMOVE COMMENT COUNT`);
                                })
                            })
                        }).catch((error) => {
                            logger.error(`ERROR IN CONVERT TO TASK ${error}`)
                        })
                    })
                })
            } catch (error) {
                reject(error);
            }
        })
    }
};

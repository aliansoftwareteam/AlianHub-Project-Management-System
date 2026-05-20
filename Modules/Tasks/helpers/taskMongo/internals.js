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

    /* -------------- (AUTO RUN ON TASK CREATE) UPDATE TASK KEY -----------------*/
    updateTaskKey({companyId, projectCode, projectId, taskId, taskTypeKey, sprintId, mainChat = false,isParentTask=true , indexObj = {}}) {
        return new Promise((resolve, reject) => {
            try {
                let obj = [
                    {
                        _id: projectId
                    },
                    {
                        $inc: {
                            'taskTypeCounts.$[elementIndex].taskCount': 1,
                            lastTaskId:1
                        }
                    },
                    {
                        arrayFilters: [
                            { "elementIndex.key": taskTypeKey}
                        ],
                        returnNewDocument: true
                    }
                ]
                let objSchema = {
                    type: mainChat ? SCHEMA_TYPE.MAIN_CHATS : SCHEMA_TYPE.PROJECTS,
                    data: obj
                }
                if (mainChat) {
                    updateMainChat(companyId, obj)
                        .then(() => {
                            resolve();
                        })
                        .catch((error) => {
                            console.error("Error in updateMainChat:", error);
                            reject(error);
                        });
                        return;
                }
                MongoDbCrudOpration(companyId, objSchema, 'findOneAndUpdate').then(async(res)=>{
                    socketEmitter.emit('update', { type: "update", data: res , updatedFields: {}, module: 'task' });
                    let taskObj;
                    let updateObj = {
                        TaskKey: `${projectCode}-${res.lastTaskId+1}`
                    }
                    if (isParentTask) {
                        updateObj[indexObj.indexName] = await this.updateTaskIndex(companyId,projectId,taskId,indexObj,`${projectCode}-${res.lastTaskId+1}`,sprintId)
                        taskObj = [
                            {
                                _id: taskId
                            },
                            {
                                $set: {
                                    ...updateObj
                                }
                            },
                            {returnDocument: "after"}
                            
                        ]
                    } else {
                        taskObj = [
                            {
                                _id: taskId
                            },
                            {
                                $set: {
                                    ...updateObj
                                }
                            },
                            {returnDocument: "after"}
                        ]
                    }
                    let objSh = {
                        type: SCHEMA_TYPE.TASKS,
                        data: taskObj
                    }
                    MongoDbCrudOpration(companyId, objSh, 'findOneAndUpdate').then((result)=>{
                        socketEmitter.emit('update', { type: "update", data: result , updatedFields: updateObj, module: 'task' });
                        resolve();
                    }).catch((error)=>{
                        reject(error)
                    })
                }).catch(error => {
                    reject(error);
                })
            } catch (error) {
                reject(error);
            }
        })
    },

    updateParentCount(companyId, taskId, value) {
        const query = {
            type: dbCollections.TASKS,
            data: [
                {
                    _id: new mongoose.Types.ObjectId(taskId)
                }, {
                    $inc: {
                        subTasks: value
                    },
                },
                {
                    returnDocument: 'after'
                }
            ]
        }

        MongoDbCrudOpration(companyId, query, "findOneAndUpdate").then((result)=>{
            socketEmitter.emit('update', { type: "update", data: result , updatedFields: {subTasks: result.subTask}, module: 'task' });
        })
        .catch((error) => {
            logger.error(`ERROR in update parent subtask count: ${error.message}`);
        })
    },

     // ADD TASK INDEX WHEN TASK IS CREATE

    /**
     * Create a taskIndex when new task is created
     * @param {String} CompanyId - CompanyId in which task is created
     * @param {String} ProjectId - ProjectId in which task is created
     * @param {String} TaskId - TaskId of new Created task
     * @param {Object} IndexObj - Index Object Which Indicate Which Type of index is need to create
     * @param {String} TaskKey - TaskKey of new Created task.
     * @param {String} SprintId - SprintId in which task is created
     * @returns {Promise<String>} A Promise that resolves with the TaskIndex in number
     *                            Rejects with an error message if any issues occur during the Find TaskIndex.
     */
    updateTaskIndex (companyId,projectId,taskId,indexObj,taskKey,sprintId)  {
        return new Promise((resolve, reject) => {
            try {
                    if (indexObj.searchKey === "AssigneeUserId" && indexObj.searchValue == "[]") {
                        let taskObj = [
                            {
                              $match: {
                                ProjectID: projectId,
                                TaskKey: {$ne: taskKey},
                                [indexObj.indexName]: { $exists: true },
                                // sprintId: sprintId,
                                AssigneeUserId: { $size: 0 }
                              }
                            },
                            { $sort: { [indexObj.indexName]: 1 } },
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
                        MongoDbCrudOpration(companyId, objSh, 'aggregate').then((resp)=>{
                            if (resp && resp[0].results && resp[0].results.length) {
                                resolve(resp[0].results[0][indexObj.indexName] - 65536)
                            } else {
                                resolve(0)
                            }
                        }).catch((error)=>{
                            reject(error)
                        })
                    } else {
                        let searchValue;
                        if (indexObj.searchKey === 'DueDate') {
                            searchValue  = {$eq: new Date(indexObj.searchValue*1000)}
                        } else if (indexObj.searchKey === 'Task_Priority') {
                            searchValue = indexObj.searchValue
                        } else {
                            searchValue = Number(indexObj.searchValue)
                        }
                        let taskObj = [
                            {
                              $match: {
                                $and: [
                                  {[indexObj.indexName]: {$exists: true}},
                                  { ProjectID: new mongoose.Types.ObjectId(projectId) },
                                //   { sprintId: sprintId },
                                  { [indexObj.searchKey]: searchValue },
                                  {[indexObj.indexName]: {$ne: -999999999999999 }}
                                ]
                              }
                            },
                            { $sort: { [indexObj.indexName]: 1 } },
                            { $limit: 1 }
                          ]
                        let objSh = {
                            type: SCHEMA_TYPE.TASKS,
                            data: [taskObj]
                        }
                        MongoDbCrudOpration(companyId, objSh, 'aggregate').then((resp)=>{
                            if (resp && resp.length) {
                                resolve(resp[0][indexObj.indexName] - 65536)
                            } else {
                                resolve(0)
                            }
                        }).catch((error)=>{
                            reject(error)
                        })
                    }
            } catch (error) {
                logger.error(`Error While Prepare Task Index of task ${taskId} Error: ${error}`);
                reject(error);
            }
        })
    },

    // UPDATE TASK FOR QUEUE LIST
    updateQueueList({CompanyId, projectId, sprintId, taskId,userId,actionType,taskName,userData}) {
        return new Promise((resolve,reject) => {
            try {
                const query = {
                    type: dbCollections.TASKS,
                    data: [
                        {
                            _id: new mongoose.Types.ObjectId(taskId)
                        }, {
                            [actionType ==='add' ? "$addToSet" : "$pull"]: {
                                queueListArray: userId
                            }
                        },
                        {returnDocument: 'after'}
                    ]
                }
                MongoDbCrudOpration(CompanyId, query, "findOneAndUpdate")
                .then((result) => {
                    socketEmitter.emit('update', { type: "update", data: result , updatedFields: {queueListArray: result.queueListArray}, module: 'task' });
                    resolve({status: true, statusText: "updateQueueList updated successfully"});
                    let historyObj = {};
                    historyObj.key = "Task_Queue";
                    if(actionType === "add"){
                        historyObj.message = `<b>${userData.Employee_Name}</b> has added this <b>${taskName}</b> task to Queuelist.`;
                    }else{
                        historyObj.message = `<b>${userData.Employee_Name}</b> has removed this <b>${taskName}</b> task from Queuelist.`;
                    }
                    historyObj.sprintId = sprintId;
                    if (historyObj !== null && Object.keys(historyObj).length > 0) {
                        HandleHistory('task',CompanyId, projectId,taskId,historyObj, userData).then(async () => {})
                        .catch((error) => {
                            logger.error(`ERROR in task status update history : ${error.message}`);
                        })
                    }
                })
                .catch((error) => {
                    reject(error)
                })
            } catch (error) {
                reject(error)
            }
        })
    },

    updateStartDateAndDueDate({commonDateFormatString, userData, notificationObj, firebaseObj,task,project}) {
        return new Promise((resolve,reject)=> {
            firebaseObj.dueDateDeadLine = firebaseObj.dueDateDeadLine.map((x) => ({date: new Date(x.date)}));
            firebaseObj.DueDate = new Date(firebaseObj.DueDate);
            firebaseObj.startDate = new Date(firebaseObj.startDate);

            const query = {
                type: dbCollections.TASKS,
                data: [
                    {
                        _id: new mongoose.Types.ObjectId(task._id)
                    }, {
                        $set: {
                            ...firebaseObj
                        },
                        $unset: {
                            groupByDueDateIndex: 1
                        },
                    },
                    {
                        returnDocument: 'after'
                    }
                ]
            }
            MongoDbCrudOpration(project.CompanyId, query, "findOneAndUpdate")
            .then((result) => {
                socketEmitter.emit('update', { type: "update", data: result , updatedFields: {...firebaseObj}, module: 'task' });
                resolve({status: true, statusText: "Start Date And Due Date updated successfully"});
                if (notificationObj && Object.keys(notificationObj).length > 0) {
                    HandleBothNotification({
                        type:'tasks',
                        userData,
                        companyId: project.CompanyId,
                        projectId: project._id,
                        taskId: task._id,
                        folderId: task.folderObjId || "",
                        sprintId: task.sprintId,
                        object: notificationObj
                    })
                    .catch((error) => {
                        logger.error(`ERROR in update Start Date : ${error.message}`);
                    })
                }
                var historyObj = {};
                historyObj.key = "Project_StartDate_DueDate";
                if (firebaseObj.dueDateDeadLine.length === 1) {
                    historyObj.message = `<b>${userData.Employee_Name}</b> has added <b> Start Date</b> as <b>DATE_${new Date(firebaseObj.startDate).getTime()}</b> and <b> Due Date</b> as <b>DATE_${new Date(firebaseObj.DueDate).getTime()} </b>.`;
                } else {
                    historyObj.message = `<b>${userData.Employee_Name}</b> has Changed <b> Start Date</b> as <b>DATE_${new Date(firebaseObj.startDate).getTime()}</b> and <b> Due Date</b> as <b>DATE_${new Date(firebaseObj.DueDate).getTime()} </b>.`;
                }
                historyObj.sprintId = task.sprintId;
                HandleHistory('task',project.CompanyId, project._id,task._id,historyObj, userData).
                catch((error) => {
                    logger.error(`ERROR in update Start Date And Due Date update hostory : ${error.message}`);
                });
            }).catch((error) => {
                reject(error);
            })
        });
    }
};

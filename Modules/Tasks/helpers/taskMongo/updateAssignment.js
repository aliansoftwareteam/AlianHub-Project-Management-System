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

    /* -------------- UPDATE ASSIGNEE ADD OR ASSIGNEE REMOVE FUNCTION FOR TASK -----------------*/

    updateAssignee({firebaseObj,projectData ,taskData,employeeName,type,userData,isUpdateTask}) {
        return new Promise((resolve,reject) => {
            try {
                if (isUpdateTask === false) {
                    let obj = {
                        'ProjectName' : projectData.ProjectName,
                        'TaskName' : taskData.TaskName,
                        'Employee_Name' : (type === 'replace') ? employeeName && Array.isArray(employeeName) ? employeeName.join(",") : employeeName : employeeName
                    }
                    var notificationObject = {};
                    var historyObj = {};
                    if(type === "assigneeAdd"){
                            notificationObject = {
                            message: taskAssigneeAdd(obj),
                            key: "task_assignee",
                        };
                        historyObj.key = "Assignee_Changed";
                        historyObj.message = `<b>${userData.Employee_Name}</b> has added the <b>${employeeName}</b> to <b>Assignee</b>.`;
                    }
                    if(type === "assigneRemove"){
                        notificationObject = {
                            message: taskAssigneeRemove(obj),
                            key: "task_assignee",
                        };
                        historyObj.key = "Assignee_Removed";
                        historyObj.message = `<b>${userData.Employee_Name}</b> has removed the <b>${employeeName}</b> to <b>Assignee</b>.`;
                    }
                    if (type === "replace") {
                        if (firebaseObj.AssigneeUserId.length) {     
                            notificationObject = {
                                message: taskAssigneeReplace(obj),
                                key: "task_assignee",
                            };
                            historyObj.key = "Assignee_Changed";
                            historyObj.message = `<b>${userData.Employee_Name}</b> has has added the <b>${employeeName}</b> to <b>Assignee</b>.`;
                        } else {
                            notificationObject = {
                                message: taskAssigneeRemove(obj),
                                key: "task_assignee",
                            };
                            historyObj.key = "Assignee_Removed";
                            historyObj.message = `<b>${userData.Employee_Name}</b> has removed the <b>${employeeName}</b> to <b>Assignee</b>.`;
                        }
                    }
                    historyObj.sprintId = taskData.sprintId;
                    if(notificationObject && Object.keys(notificationObject).length > 0) {
                        HandleBothNotification({
                            type:'tasks',
                            userData,
                            companyId: projectData.CompanyId,
                            projectId:projectData._id,
                            taskId:taskData._id,
                            folderId:taskData.folderObjId || "",
                            sprintId:taskData.sprintId,
                            object:notificationObject
                        })
                        .catch((error) => {
                            logger.error(`ERROR in notification: ${error.message}`);
                        });
                    }
                    HandleHistory('task',projectData.CompanyId, projectData._id,taskData._id,historyObj, userData)
                    .catch((error) => {
                        logger.error(`ERROR in history: ${error.message}`);
                    });
                    resolve({status: true, statusText: "Priority updated successfully"});
                } else {
                    if(type !== "assigneeAdd" && type !== "assigneRemove" && type !== "replace") {
                        reject(new Error("Invalid type"))
                        return;
                    }
                    let uid = firebaseObj.AssigneeUserId;
                    let object = {
                        type: dbCollections.TASKS,
                        data: [
                            {
                                _id : taskData._id
                            }
                        ]
                    }

                    MongoDbCrudOpration(projectData.CompanyId,object, "findOne").then((response) => {
                        let updateTask = true;
                        if (!response) {
                            throw new Error("Task document does not exist!");
                        }
                        let assigneeUserId = response.AssigneeUserId || [];

                        let mongoUpdateObj = {}

                        if(type === "assigneeAdd") {
                            mongoUpdateObj = {
                                $addToSet: {AssigneeUserId: firebaseObj.AssigneeUserId}
                            }
                        } else if (type === "replace") {
                            mongoUpdateObj = {
                                $set: {AssigneeUserId: firebaseObj.AssigneeUserId}
                            }
                        } else {
                            mongoUpdateObj = {
                                $pull: {AssigneeUserId: firebaseObj.AssigneeUserId}
                            }
                        }

                        if(updateTask) {
                            let object = {
                                type: SCHEMA_TYPE.TASKS,
                                data: [
                                    { _id: new mongoose.Types.ObjectId(taskData._id) },
                                    {
                                        ...mongoUpdateObj,
                                        $unset: {
                                            groupByAssigneeIndex: ''
                                        },
                                    },
                                    {returnDocument: "after"}
                                ]
                            }
                            MongoDbCrudOpration(projectData.CompanyId,object, "findOneAndUpdate").then((result) => {
                                socketEmitter.emit('update', { type: "update", data: result , updatedFields: mongoUpdateObj, module: 'task' });
                                resolve({status: true, statusText: "Assignee updated successfully"});
                                try {
                                    this.updateWatcher({companyId : projectData.CompanyId, projectId: projectData._id, sprintId: taskData.sprintId, taskId: taskData._id, userId: uid, add: type === "assigneeAdd", type: type,userData:userData,employeeName:employeeName})
                                    .catch((error) => {
                                        logger.error("ERROR in update watcher:", error);
                                    })
                                } catch (error) {
                                    logger.error("ERROR in update watcher:", error);
                                }
                                let obj = {
                                    'ProjectName' : projectData.ProjectName,
                                    'TaskName' : taskData.TaskName,
                                    'Employee_Name' : (type === 'replace') ? employeeName && Array.isArray(employeeName) ? employeeName.join(",") : employeeName : employeeName
                                }
                                var notificationObject = {};
                                var historyObj = {};
                                if(type === "assigneeAdd"){
                                        notificationObject = {
                                        message: taskAssigneeAdd(obj),
                                        key: "task_assignee",
                                    };
                                    historyObj.key = "Assignee_Changed";
                                    historyObj.message = `<b>${userData.Employee_Name}</b> has added the <b>${employeeName}</b> to <b>Assignee</b>.`;
                                }
                                if(type === "assigneRemove"){
                                    notificationObject = {
                                        message: taskAssigneeRemove(obj),
                                        key: "task_assignee",
                                    };
                                    historyObj.key = "Assignee_Removed";
                                    historyObj.message = `<b>${userData.Employee_Name}</b> has removed the <b>${employeeName}</b> to <b>Assignee</b>.`;
                                }
                                if (type === "replace") {
                                    if (firebaseObj.AssigneeUserId.length) {     
                                        notificationObject = {
                                            message: taskAssigneeReplace(obj),
                                            key: "task_assignee",
                                        };
                                        historyObj.key = "Assignee_Changed";
                                        historyObj.message = `<b>${userData.Employee_Name}</b> has has added the <b>${employeeName}</b> to <b>Assignee</b>.`;
                                    } else {
                                        notificationObject = {
                                            message: taskAssigneeRemove(obj),
                                            key: "task_assignee",
                                        };
                                        historyObj.key = "Assignee_Removed";
                                        historyObj.message = `<b>${userData.Employee_Name}</b> has removed the <b>${employeeName}</b> to <b>Assignee</b>.`;
                                    }
                                }
                                historyObj.sprintId = taskData.sprintId;
                                if(notificationObject && Object.keys(notificationObject).length > 0) {
                                    HandleBothNotification({
                                        type:'tasks',
                                        userData,
                                        companyId: projectData.CompanyId,
                                        projectId:projectData._id,
                                        taskId:taskData._id,
                                        folderId:taskData.folderObjId || "",
                                        sprintId:taskData.sprintId,
                                        object:notificationObject
                                    })
                                    .catch((error) => {
                                        logger.error(`ERROR in notification: ${error.message}`);
                                    });
                                }
                                HandleHistory('task',projectData.CompanyId, projectData._id,taskData._id,historyObj, userData)
                                .catch((error) => {
                                    logger.error(`ERROR in history: ${error.message}`);
                                });
                            })
                            return assigneeUserId;
                        } else {
                            return false;
                        }
                    })
                }
            } catch (error) {
                reject(error)
            }
        })
    },

    /* -------------- UPDATE TASK LEADER (CREATED BY) FUNCTION FOR TASK -----------------*/

    updateTaskLeader({firebaseObj, projectData, taskData, employeeName, userData, isUpdateTask}) {
        return new Promise((resolve, reject) => {
            try {
                const newLeaderId = firebaseObj && firebaseObj.Task_Leader;
                if (!newLeaderId) {
                    reject(new Error("Task_Leader is required"));
                    return;
                }

                // SIDE-EFFECTS ONLY (history) — parity with updateAssignee/updateStatus/updatePriority
                if (isUpdateTask === false) {
                    const historyObj = {
                        key: "TaskLeader_Changed",
                        message: `<b>${userData.Employee_Name}</b> has changed <b>Created by</b> to <b>${employeeName}</b>.`,
                        sprintId: taskData.sprintId,
                    };
                    HandleHistory('task', projectData.CompanyId, projectData._id, taskData._id, historyObj, userData)
                    .catch((error) => {
                        logger.error(`ERROR in history: ${error.message}`);
                    });
                    resolve({status: true, statusText: "Task leader updated successfully"});
                    return;
                }

                // DB-WRITE PATH
                const findObj = {
                    type: dbCollections.TASKS,
                    data: [{ _id: taskData._id }]
                };
                MongoDbCrudOpration(projectData.CompanyId, findObj, "findOne").then((response) => {
                    if (!response) {
                        throw new Error("Task document does not exist!");
                    }

                    const mongoUpdateObj = { $set: { Task_Leader: newLeaderId } };
                    const updateObj = {
                        type: SCHEMA_TYPE.TASKS,
                        data: [
                            { _id: new mongoose.Types.ObjectId(taskData._id) },
                            mongoUpdateObj,
                            { returnDocument: "after" }
                        ]
                    };
                    MongoDbCrudOpration(projectData.CompanyId, updateObj, "findOneAndUpdate").then((result) => {
                        socketEmitter.emit('update', { type: "update", data: result, updatedFields: { Task_Leader: newLeaderId }, module: 'task' });
                        resolve({status: true, statusText: "Task leader updated successfully"});

                        const historyObj = {
                            key: "TaskLeader_Changed",
                            message: `<b>${userData.Employee_Name}</b> has changed <b>Created by</b> to <b>${employeeName}</b>.`,
                            sprintId: taskData.sprintId,
                        };
                        HandleHistory('task', projectData.CompanyId, projectData._id, taskData._id, historyObj, userData)
                        .catch((error) => {
                            logger.error(`ERROR in history: ${error.message}`);
                        });
                    }).catch((error) => {
                        reject(error);
                    });
                }).catch((error) => {
                    reject(error);
                });
            } catch (error) {
                reject(error);
            }
        });
    },

    /* -------------- UPDATE TASK WATCHER -----------------*/
    updateWatcher({companyId, projectId, sprintId, taskId, userId, add, userData, employeeName}) {
        return new Promise((resolve, reject) => {
            try {
                const schema = SCHEMA_TYPE.TASKS
                let queryObj = {};
                let queryFilter;

                if (add) {
                    queryObj.$addToSet = { watchers: userId };
                    queryFilter = { _id: new mongoose.Types.ObjectId(taskId) };
                } else {
                    // Update the 'name' of the specific object in the 'settings' array matching the given 'key'
                    queryFilter = {
                        _id: new mongoose.Types.ObjectId(taskId),
                    };
                    queryObj.$pull = { watchers: userId };
                };

                let obj = {
                    type: schema,
                    data: [
                        queryFilter,
                        queryObj,
                        { upsert: true,
                           returnDocument: 'after' 
                         }
                    ]
                }

                MongoDbCrudOpration(companyId, obj, "findOneAndUpdate").then((response) => {
                    socketEmitter.emit('update', { type: "update", data: response , updatedFields: {}, module: 'task' });
                    resolve({status: true, statusText: `Watcher updated successfully `});
                    var historyObj = {};
                    if(add === true){
                        historyObj.key = "Watcher_Changed";
                        historyObj.message = `<b>${userData.Employee_Name}</b> has added the <b>${employeeName}</b> to <b>Watcher</b>.`;
                    }
                    if(add === false){
                        historyObj.key = "Watcher_Removed";
                        historyObj.message = `<b>${userData.Employee_Name}</b> has removed the <b>${employeeName}</b> to <b>Watcher</b>.`;
                    }
                    HandleHistory('task',companyId, projectId,taskId,historyObj, userData)
                    .catch((error) => {
                        logger.error(`ERROR in history: ${error}`);
                    });
                });
            } catch (error) {
                reject(error);
            }
        })
    },
    updateTaskType({newStatus, prevStatus, projectData, taskData, userData, isUpdateTask}) {
        return new Promise((resolve,reject) => {
            try {
                if (isUpdateTask === false) {
                    resolve({status: true, statusText: "Tasktype updated successfully"});
                    let notificationObj = {
                        'ProjectName' : projectData?.ProjectName,
                        'taskName' : taskData?.TaskName,
                        'oldTaskTypeImage' : prevStatus?.taskImage,
                        'oldTaskTypeName' : prevStatus?.name,
                        'newTaskTypeImage' : newStatus?.taskTypeImage,
                        'newTaskTypeName' : newStatus?.taskTypeName
                    };
                    let notificationObject = {
                        key: "task_type",
                        message : taskTypeChage(notificationObj),
                    };
                    if (notificationObject && Object.keys(notificationObject).length > 0 && prevStatus?.name !== newStatus?.taskTypeName) {
                        HandleBothNotification({
                            type:'tasks',
                            userData,
                            companyId: projectData.CompanyId,
                            projectId:projectData._id,
                            taskId:taskData._id,
                            folderId: taskData.folderObjId || "",
                            sprintId:taskData.sprintId,
                            object:notificationObject,
                            changeType:'tasktype',
                            changeData: notificationObj
                        })
                        .catch((error) => {
                            logger.error(`ERROR in notification Task Type: ${error.message}`);
                        })
                    }

                    let historyObj = {};
                    historyObj.key = "Task_TYPE";
                    historyObj.message = `<b>${userData.Employee_Name}</b> has changed <b> Task Type</b> as <b>${newStatus?.taskTypeName}</b>.`;
                    historyObj.sprintId = taskData.sprintId;
                    
                    if (historyObj !== null && Object.keys(historyObj).length > 0) {
                        HandleHistory('task',projectData.CompanyId, projectData._id,taskData._id,historyObj, userData).then(async () => {})
                        .catch((error) => {
                            logger.error(`ERROR in task status update history : ${error.message}`);
                        })
                    }
                } else {
                    let updatedTaskObj = JSON.parse(JSON.stringify(newStatus));
                    delete updatedTaskObj.taskTypeImage;
                    delete updatedTaskObj.taskTypeName;
                    delete updatedTaskObj.oldTaskTypeImage;
                    
                    const query = {
                        type: dbCollections.TASKS,
                        data: [
                            {
                                _id: new mongoose.Types.ObjectId(taskData._id)
                            }, {
                                $set: {
                                    ...updatedTaskObj,
                                },
                                $unset: {
                                    groupByStatusIndex: 1
                                }
                            },
                            {returnDocument: "after"}
                        ]
                    }

                    MongoDbCrudOpration(projectData.CompanyId, query, "findOneAndUpdate")
                    .then((result) => {
                        socketEmitter.emit('update', { type: "update", data: result , updatedFields: updatedTaskObj, module: 'task' });
                        resolve({status: true, statusText: "Tasktype updated successfully"});

                        let notificationObj = {
                            'ProjectName' : projectData?.ProjectName,
                            'taskName' : taskData?.TaskName,
                            'oldTaskTypeImage' : prevStatus?.taskImage,
                            'oldTaskTypeName' : prevStatus?.name,
                            'newTaskTypeImage' : newStatus?.taskTypeImage,
                            'newTaskTypeName' : newStatus?.taskTypeName
                        };
                        let notificationObject = {
                            key: "task_type",
                            message : taskTypeChage(notificationObj),
                        };
                        if (notificationObject && Object.keys(notificationObject).length > 0 && prevStatus?.name !== newStatus?.taskTypeName) {
                            HandleBothNotification({
                                type:'tasks',
                                userData,
                                companyId: projectData.CompanyId,
                                projectId:projectData._id,
                                taskId:taskData._id,
                                folderId: taskData.folderObjId || "",
                                sprintId:taskData.sprintId,
                                object:notificationObject,
                                changeType:'tasktype',
                                changeData: notificationObj
                            })
                            .catch((error) => {
                                logger.error(`ERROR in notification Task Type: ${error.message}`);
                            })
                        }
    
                        let historyObj = {};
                        historyObj.key = "Task_TYPE";
                        historyObj.message = `<b>${userData.Employee_Name}</b> has changed <b> Tasktype</b> as <b>${newStatus?.taskTypeName}</b>.`;
                        historyObj.sprintId = taskData.sprintId;
                        
                        if (historyObj !== null && Object.keys(historyObj).length > 0) {
                            HandleHistory('task',projectData.CompanyId, projectData._id,taskData._id,historyObj, userData).then(async () => {})
                            .catch((error) => {
                                logger.error(`ERROR in task tasktype update history : ${error.message}`);
                            })
                        }
                    })
                    .catch((error) => {
                        logger.error(`ERROR in task tasktype update history : ${error.message}`);
                        reject(error)
                    })
                }
            } catch (error) {
                logger.error(`ERROR in task tasktype update history : ${error.message}`);
                reject(error)
            }
        })
    }
};

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

    /* -------------- UPDATE DUE DATE FUNCTION FOR TASK -----------------*/

    updateDueDate({commonDateFormatString ,firebaseObj, project, task, obj,userData, isUpdateTask}) {
        return new Promise((resolve,reject) => {
            try {
                // MAKE CHANGES FOR DUE DATE
                if (isUpdateTask === false) {
                    if (obj && Object.keys(obj).length > 0) {
                        HandleBothNotification({
                            type:'tasks',
                            userData,
                            companyId: project.CompanyId,
                            projectId: project._id,
                            taskId: task._id,
                            folderId: task.folderObjId || "",
                            sprintId: task.sprintId,
                            object: obj
                        })
                        .catch((error) => {
                            logger.error(`ERROR in notification Update Due Date: ${error.message}`);
                        })
                    }
                    var historyObj = {};
                    historyObj.key = "Project_DueDate";
                    historyObj.message = `<b>${userData.Employee_Name}</b> has added <b> Due Date</b> as <b>DATE_${new Date(firebaseObj.DueDate).getTime()}</b>.`;
                    historyObj.sprintId = task.sprintId;
                    HandleHistory('task',project.CompanyId, project._id,task._id,historyObj, userData).
                    catch((error) => {
                        logger.error(`ERROR in task history : ${error.message}`);
                    });
                    resolve({status: true, statusText: "Priority updated successfully"});
                } else {
                    firebaseObj.dueDateDeadLine = firebaseObj.dueDateDeadLine.map((x) => ({date: new Date(x.date)}));
                    firebaseObj.DueDate = firebaseObj.DueDate === null ? null : new Date(firebaseObj.DueDate);

                    let object = {
                        type: SCHEMA_TYPE.TASKS,
                        data: [{ _id: new mongoose.Types.ObjectId(task._id) },{
                            $set: { ...firebaseObj },
                            $unset: {
                                groupByDueDateIndex: ''
                            },
                        },{returnDocument: 'after'}]
                    }
                    MongoDbCrudOpration(project.CompanyId,object, "findOneAndUpdate")
                    .then((result) => {
                        socketEmitter.emit('update', { type: "update", data: result , updatedFields: firebaseObj, module: 'task' });
                        resolve({status: true, statusText: "Due Date updated successfully"});
    
                        if (obj && Object.keys(obj).length > 0) {
                            HandleBothNotification({
                                type:'tasks',
                                userData,
                                companyId: project.CompanyId,
                                projectId: project._id,
                                taskId: task._id,
                                folderId: task.folderObjId || "",
                                sprintId: task.sprintId,
                                object: obj
                            })
                            .catch((error) => {
                                logger.error(`ERROR in notification Update Due Date: ${error.message}`);
                            })
                        }
                        var historyObj = {};
                        historyObj.key = "Project_DueDate";
                        historyObj.message = `<b>${userData.Employee_Name}</b> has added <b> Due Date</b> as <b>DATE_${new Date(firebaseObj.DueDate).getTime()}</b>.`;
                        historyObj.sprintId = task.sprintId;
                        HandleHistory('task',project.CompanyId, project._id,task._id,historyObj, userData).
                        catch((error) => {
                            logger.error(`ERROR in task history : ${error.message}`);
                        });
                    })
                    .catch((error) => {
                        logger.error(`ERROR in task history : ${error.message}`);
                        reject(error)
                    })
                }
            } catch (error) {
                logger.error(`ERROR in task history : ${error.message}`);
                reject(error)
            }
        })
    },

    /* -------------- UPDATE Start DATE FUNCTION FOR TASK -----------------*/

    updateStartDate({commonDateFormatString ,firebaseObj, project, task, obj,userData,isUpdateTask = true,isHistory=true}) {
        return new Promise((resolve,reject) => {
            try {
                // MAKE CHANGES FOR START DATE
                if (isUpdateTask == false) {
                    if (obj && Object.keys(obj).length > 0) {
                        HandleBothNotification({
                            type:'tasks',
                            userData,
                            companyId: project.CompanyId,
                            projectId: project._id,
                            taskId: task._id,
                            folderId: task.folderObjId || "",
                            sprintId: task.sprintId,
                            object: obj
                        })
                        .catch((error) => {
                            logger.error(`ERROR in update Start Date : ${error.message}`);
                        })
                    }
                    if(isHistory){
                        var historyObj = {};
                        historyObj.key = "Project_DueDate";
                        historyObj.message = `<b>${userData.Employee_Name}</b> has added <b> Start Date</b> as <b>DATE_${new Date(firebaseObj.startDate).getTime()}</b>.`;
                        historyObj.sprintId = task.sprintId;
                        HandleHistory('task',project.CompanyId, project._id,task._id,historyObj, userData).
                        catch((error) => {
                            logger.error(`ERROR in update Start Date update hostory : ${error.message}`);
                        });
                    }
                } else {
                    firebaseObj.startDate = new Date(firebaseObj.startDate);

                    let object = {
                        type:SCHEMA_TYPE.TASKS,
                        data: [
                            { _id: new mongoose.Types.ObjectId(task._id) },
                            { ...firebaseObj },
                            {returnDocument: "after"}
                        ]
                    }
                    MongoDbCrudOpration(project.CompanyId,object, "findOneAndUpdate")
                    .then((result) => {
                        socketEmitter.emit('update', { type: "update", data: result , updatedFields: firebaseObj, module: 'task' });
                        resolve({status: true, statusText: "Start Date updated successfully"});
    
                        if (obj && Object.keys(obj).length > 0) {
                            HandleBothNotification({
                                type:'tasks',
                                userData,
                                companyId: project.CompanyId,
                                projectId: project._id,
                                taskId: task._id,
                                folderId: task.folderObjId || "",
                                sprintId: task.sprintId,
                                object: obj
                            })
                            .catch((error) => {
                                logger.error(`ERROR in update Start Date : ${error.message}`);
                            })
                        }
                        if(isHistory){
                            var historyObj = {};
                            historyObj.key = "Project_DueDate";
                            historyObj.message = `<b>${userData.Employee_Name}</b> has added <b> Start Date</b> as <b>DATE_${new Date(firebaseObj.startDate).getTime()}</b>.`;
                            historyObj.sprintId = task.sprintId;
                            HandleHistory('task',project.CompanyId, project._id,task._id,historyObj, userData).
                            catch((error) => {
                                logger.error(`ERROR in update Start Date update hostory : ${error.message}`);
                            });
                        }
                    })
                    .catch((error) => {
                        logger.error(`ERROR in update Start Date : ${error.message}`);
                        reject(error)
                    })
                }
            } catch (error) {
                logger.error(`ERROR in update Start Date : ${error.message}`);
                reject(error)
            }
        })
    },

    /* -------------- UPDATE STATUS FUNCTION FOR TASK -----------------*/

    updateStatus({newStatus, prevStatus, projectData, task, userData, isUpdateTask}) {
        return new Promise((resolve,reject) => {
            try {
                if (isUpdateTask === false) {
                    resolve({status: true, statusText: "Status updated successfully"});
                    let obj = {
                        'ProjectName': projectData.ProjectName,
                        'taskName': prevStatus.taskName,
                        'backColor': prevStatus.backColor,
                        'color': prevStatus.color,
                        'statusName': prevStatus.statusName,
                        'bgColor': prevStatus.bgColor,
                        'textColor': prevStatus.textColor,
                        'newStatusName': newStatus.status.text
                    }
                    let notificationObject = {
                        message: taskStatusChange(obj),
                        key: "task_status",
                        projectId: projectData._id,
                        taskId: prevStatus.taskId,
                        sprintId: task.sprintId
                    }
                    if (notificationObject && Object.keys(notificationObject).length > 0 && prevStatus.updatedTaskName !== prevStatus.name) {
                        HandleBothNotification({
                            type:'tasks',
                            userData,
                            companyId: projectData.CompanyId,
                            projectId:projectData._id,
                            taskId:prevStatus.taskId,
                            folderId: task.folderObjId || "",
                            sprintId:task.sprintId,
                            object:notificationObject,
                            changeType:'status',
                            changeData: obj
                        })
                        .catch((error) => {
                            logger.error(`ERROR in notification Task Status: ${error.message}`);
                        })
                    }

                    let historyObj = {};
                    historyObj.key = "Task_Status";
                    historyObj.message = `<b>${userData.Employee_Name}</b> has changed <b> Status</b> as <b>${prevStatus.updatedTaskName}</b>.`;
                    historyObj.sprintId = task.sprintId;
                    if (historyObj !== null && Object.keys(historyObj).length > 0) {
                        HandleHistory('task',projectData.CompanyId, projectData._id,prevStatus.taskId,historyObj, userData).then(async () => {})
                        .catch((error) => {
                            logger.error(`ERROR in task status update history : ${error.message}`);
                        })
                    }
                } else {
                    const query = {
                        type: dbCollections.TASKS,
                        data: [
                            {
                                _id: new mongoose.Types.ObjectId(prevStatus.taskId)
                            }, {
                                $set: {
                                    ...newStatus,
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
                        socketEmitter.emit('update', { type: "update", data: result , updatedFields: newStatus, module: 'task' });
                        resolve({status: true, statusText: "Status updated successfully"});

                        let obj = {
                            'ProjectName': projectData.ProjectName,
                            'taskName': prevStatus.taskName,
                            'backColor': prevStatus.backColor,
                            'color': prevStatus.color,
                            'statusName': prevStatus.statusName,
                            'bgColor': prevStatus.bgColor,
                            'textColor': prevStatus.textColor,
                            'newStatusName': newStatus.status.text
                        }
                        let notificationObject = {
                            message: taskStatusChange(obj),
                            key: "task_status",
                            projectId: projectData._id,
                            taskId: prevStatus.taskId,
                            sprintId: task.sprintId
                        }
                        if (notificationObject && Object.keys(notificationObject).length > 0 && prevStatus.updatedTaskName !== prevStatus.name) {
                            HandleBothNotification({
                                type:'tasks',
                                userData,
                                companyId: projectData.CompanyId,
                                projectId:projectData._id,
                                taskId:prevStatus.taskId,
                                folderId: task.folderObjId || "",
                                sprintId:task.sprintId,
                                object:notificationObject,
                                changeType:'status',
                                changeData: obj
                            })
                            .catch((error) => {
                                logger.error(`ERROR in notification Task Status: ${error.message}`);
                            })
                        }
    
                        let historyObj = {};
                        historyObj.key = "Task_Status";
                        historyObj.message = `<b>${userData.Employee_Name}</b> has changed <b> Status</b> as <b>${prevStatus.updatedTaskName}</b>.`;
                        historyObj.sprintId = task.sprintId;
                        if (historyObj !== null && Object.keys(historyObj).length > 0) {
                            HandleHistory('task',projectData.CompanyId, projectData._id,prevStatus.taskId,historyObj, userData).then(async () => {})
                            .catch((error) => {
                                logger.error(`ERROR in task status update history : ${error.message}`);
                            })
                        }
                    })
                    .catch((error) => {
                        logger.error(`ERROR in task status update history : ${error.message}`);
                        reject(error)
                    })
                }
            } catch (error) {
                logger.error(`ERROR in task status update history : ${error.message}`);
                reject(error)
            }
        })
    },

    /* -------------- UPDATE PRIORITY FUNCTION FOR TASK -----------------*/

    updatePriority({firebaseObj ,projectData ,taskData ,priorityObj, userData,isUpdateTask}) {
        return new Promise((resolve,reject) => {
            try {
                if (isUpdateTask === false) {
                    resolve({status: true, statusText: "Priority updated successfully"});
                    let notificationObj = {
                        'ProjectName' : projectData?.ProjectName,
                        'taskName' : priorityObj?.taskName,
                        'statusImage' : priorityObj?.statusImage,
                        'priorityName' : priorityObj?.priorityName,
                        'newStatusImage' : priorityObj?.newStatusImage,
                        'newPriorityName' : priorityObj?.newPriorityName
                    };
                    let notificationObject = {
                        key: "task_priority",
                        message : taskPriorityChange(notificationObj),
                    };
                  
                     if(notificationObject && Object.keys(notificationObject).length > 0 && priorityObj.newPriorityName !== priorityObj.priorityName) {
                        HandleBothNotification({
                            type:'tasks',
                            userData,
                            companyId: projectData.CompanyId,
                            projectId:projectData._id,
                            taskId:priorityObj.taskId,
                            folderId: taskData.folderObjId || "",
                            sprintId:taskData.sprintId,
                            object:notificationObject,
                            changeType:'priority',
                            changeData: notificationObj
                        })
                        .catch((error) => {
                            logger.error(`ERROR in notification Task Priority: ${error.message}`);
                        });
                    }

                    let historyObj = {
                        key: "task_priority",
                        message : `<b>${userData.Employee_Name}</b> has changed <b> Priority</b> as <b>${priorityObj.newPriorityName}</b>.`,
                        sprintId: taskData.sprintId
                    };
                    HandleHistory('task',projectData.CompanyId, projectData._id,priorityObj.taskId,historyObj, userData).then(async () => {});
                } else {
                    const query = {
                        type: dbCollections.TASKS,
                        data: [
                            {
                                _id: new mongoose.Types.ObjectId(priorityObj.taskId)
                            }, {
                                $set: {
                                    ...firebaseObj,
                                },
                                $unset: {
                                    groupByPriorityIndex: 1
                                }
                            },
                            {returnDocument: "after"}
                        ]
                    }

                    MongoDbCrudOpration(projectData.CompanyId, query, "findOneAndUpdate")
                    .then((result) => {
                        socketEmitter.emit('update', { type: "update", data: result , updatedFields: firebaseObj, module: 'task' });
                        resolve({status: true, statusText: "Priority updated successfully"});
                        let notificationObj = {
                            'ProjectName' : projectData?.ProjectName,
                            'taskName' : priorityObj?.taskName,
                            'statusImage' : priorityObj?.statusImage,
                            'priorityName' : priorityObj?.priorityName,
                            'newStatusImage' : priorityObj?.newStatusImage,
                            'newPriorityName' : priorityObj?.newPriorityName
                        };
                        let notificationObject = {
                            key: "task_priority",
                            message : taskPriorityChange(notificationObj),
                        };
                     
                         if(notificationObject && Object.keys(notificationObject).length > 0 && priorityObj.newPriorityName !== priorityObj.priorityName) {
                            HandleBothNotification({
                                type:'tasks',
                                userData,
                                companyId: projectData.CompanyId,
                                projectId:projectData._id,
                                taskId:priorityObj.taskId,
                                folderId: taskData.folderObjId || "",
                                sprintId:taskData.sprintId,
                                object:notificationObject,
                                changeType:'priority',
                                changeData: notificationObj
                            })
                            .catch((error) => {
                                logger.error(`ERROR in notification Task Priority: ${error.message}`);
                            });
                        }

                        let historyObj = {
                            key: "task_priority",
                            message : `<b>${userData.Employee_Name}</b> has changed <b> Priority</b> as <b>${priorityObj.newPriorityName}</b>.`,
                            sprintId: taskData.sprintId
                        };
                        HandleHistory('task',projectData.CompanyId, projectData._id,priorityObj.taskId,historyObj, userData).then(async () => {});
                    })
                    .catch((error) => {
                        logger.error(`ERROR in task status: ${error.message}`);
                        reject(error)
                    })
                }
            } catch (error) {
                logger.error(`ERROR in task status : ${error.message}`);
                reject(error)
            }
        })
    },

    /* -------------- UPDATE TASK NAME FUNCTION -----------------*/

    updateTaskName({firebaseObj,projectData ,taskData , obj, userData}) {
        return new Promise((resolve,reject) => {
            try {
                const query = {
                    type: dbCollections.TASKS,
                    data: [
                        {
                            _id: new mongoose.Types.ObjectId(taskData._id)
                        }, {
                            $set: {
                                ...firebaseObj
                            }
                        },
                        {returnDocument: "after"}
                    ]
                }
                MongoDbCrudOpration(projectData.CompanyId, query, "findOneAndUpdate")
                .then((result) => {
                    socketEmitter.emit('update', { type: "update", data: result , updatedFields: firebaseObj, module: 'task' });
                    resolve({status: true, statusText: "Task name updated successfully"});

                    const sanitizedOldTaskName = sanitizeInput(obj.previousTaskName);
                    const sanitizedNewTaskName = sanitizeInput(firebaseObj.TaskName);
                    let editTaskObj = {
                        'ProjectName' : projectData.ProjectName,
                        'previousTaskName' : obj.previousTaskName,
                        'TaskName' : firebaseObj.TaskName
                    } 
                    let notificationObject = {
                        key: "task_edit",
                        message : taskNameEdit(editTaskObj),
                    };
                    if(notificationObject && Object.keys(notificationObject).length > 0) {
                        HandleBothNotification({
                            type:'tasks',
                            userData,
                            companyId: projectData.CompanyId,
                            projectId:projectData._id,
                            taskId:taskData._id,
                            folderId: taskData.folderObjId || "",
                            sprintId:taskData.sprintId,
                            object:notificationObject,
                            changeType:'name',
                            changeData: editTaskObj
                        })
                        .catch((error) => {
                            logger.error(`ERROR in notification: ${error.message}`);
                        });
                    }
                    let historyObj = {
                        key: "task_name_edit",
                        message : `<b>${obj.userName}</b> has changed <b> Task name</b> from <b>${sanitizedOldTaskName}</b> to <b>${sanitizedNewTaskName}</b>.`,
                        sprintId: taskData.sprintId
                    };
                    HandleHistory('task',projectData.CompanyId, projectData._id,taskData._id,historyObj, userData).then(async () => {});
                })
                .catch((error) => {
                    logger.error(`ERROR in task Name update : ${error.message}`);
                    reject(error)
                })
            } catch (error) {
                logger.error(`ERROR in task Name update : ${error.message}`);
                reject(error)
            }
        })
    }
};

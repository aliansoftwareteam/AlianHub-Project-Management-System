const { dbCollections } = require('../../../Config/collections')
const { HandleHistory} = require("./helper")
const { taskNameEdit, taskPriorityChange, taskStatusChange,} = require('./notificationTemplate')
const { HandleBothNotification } = require("./handleNotification")
const logger = require("../../../Config/loggerConfig")
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries")
const { default: mongoose } = require("mongoose")
class Task {
    
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
                        sprintId: task.sprintArray.id
                    }
                    if (notificationObject && Object.keys(notificationObject).length > 0 && prevStatus.updatedTaskName !== prevStatus.name) {
                        HandleBothNotification({
                            type:'tasks',
                            userData,
                            companyId: projectData.CompanyId,
                            projectId:projectData._id,
                            taskId:prevStatus.taskId,
                            folderId: task.sprintArray.folderId || "",
                            sprintId:task.sprintArray.id,
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
                    historyObj.sprintId = task.sprintArray.id;
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
                            }
                        ]
                    }

                    MongoDbCrudOpration(projectData.CompanyId, query, "updateOne")
                    .then(() => {
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
                            sprintId: task.sprintArray.id
                        }
                        if (notificationObject && Object.keys(notificationObject).length > 0 && prevStatus.updatedTaskName !== prevStatus.name) {
                            HandleBothNotification({
                                type:'tasks',
                                userData,
                                companyId: projectData.CompanyId,
                                projectId:projectData._id,
                                taskId:prevStatus.taskId,
                                folderId: task.sprintArray.folderId || "",
                                sprintId:task.sprintArray.id,
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
                        historyObj.sprintId = task.sprintArray.id;
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
    }

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
                            folderId: taskData.sprintArray.folderId || "",
                            sprintId:taskData.sprintArray.id,
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
                        sprintId: taskData.sprintArray.id
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
                            }
                        ]
                    }

                    MongoDbCrudOpration(projectData.CompanyId, query, "updateOne")
                    .then(() => {

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
                                folderId: taskData.sprintArray.folderId || "",
                                sprintId:taskData.sprintArray.id,
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
                            sprintId: taskData.sprintArray.id
                        };
                        HandleHistory('task',projectData.CompanyId, projectData._id,priorityObj.taskId,historyObj, userData).then(async () => {});
                    })
                    .catch((error) => {
                        logger.error(`ERROR in task status : ${error.message}`);
                        reject(error)
                    })
                }
            } catch (error) {
                logger.error(`ERROR in task status : ${error.message}`);
                reject(error)
            }
        })
    }

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
                        }
                    ]
                }
                MongoDbCrudOpration(projectData.CompanyId, query, "updateOne")
                .then(() => {
                    resolve({status: true, statusText: "Task name updated successfully"});

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
                            folderId: taskData.sprintArray.folderId || "",
                            sprintId:taskData.sprintArray.id,
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
                        message : `<b>${obj.userName}</b> has changed <b> Task name</b> from <b>${obj.previousTaskName}</b> to <b>${firebaseObj.TaskName}</b>.`,
                        sprintId: taskData.sprintArray.id
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
}

exports.task = new Task();
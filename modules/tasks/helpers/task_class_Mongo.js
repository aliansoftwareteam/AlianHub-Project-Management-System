const { dbCollections } = require('../../../Config/collections')
const { sanitizeInput } = require("../../serviceFunction");
const { HandleHistory,HandleTask,convertToSubTaskFunction, moveTaskFunction, convertToListSubTask,mergeSubTask, duplicateSubTaskFunction, addHistoryCollection, removeCommentCount,updateHistoryCollection, updateTimesheetCollection, updateEstimatedTimeCollection} = require("./mongo_helper")

const { createTask, taskAssigneeAdd, taskAssigneeRemove,taskAssigneeReplace, taskNameEdit, taskPriorityChange, taskStatusChange, taskAttachmentAdd, taskAttachmentRemove, taskTypeChage, taskTotalEstimate } = require('./notificationTemplate')
const { HandleBothNotification } = require("./handleNotification")
const logger = require("../../../Config/loggerConfig")
const { addSprintFun, updateSprintFun } = require("../../sprints/controller")
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { default: mongoose } = require("mongoose")
const { updateUnReadCommentsCountFun } = require("../../notification-count/controller")
const { handleTaskAttachmentsDuplicateFunctionality } = require(`../../../common-storage/common-${process.env.STORAGE_TYPE}.js`)
const { buildQueryObject, buildHistoryObject, convertToDisplayFormat } = require("./helper");
const socketEmitter = require('../../../event/socketEventEmitter');
const { addCommentCollection, updateCommentCollection } = require('../../comments/controller')
const { updateMainChat } = require('../../main-chats/controller');
const { replaceObjectKey } = require("../../auth/helper");
const { emitListener } = require("../../company/event-controller.js");
const { createCustomFields } = require("./helper.js");
const { removeCache } = require('../../../utils/commonFunctions.js');
const { updateRemainingTime } = require('../../log-time/controllerV2.js');
class Task {
    create({data, user, projectData ,indexObj, setNotif}) {
        return new Promise((resolve,reject) => {
            try {
                // CHECK VALIDATION IF ANY
                HandleTask(projectData.CompanyId, data, false, data.id || null, user , indexObj)
                .then((taskResult) => {
                    if(taskResult.status){
                        resolve(taskResult);
    
                       // UPDATE TASK COUNT IN SPRINT 
                        let updateObject = {
                            $inc: { tasks: 1}
                        }
                        const countObj = {
                            body: {
                                companyId: projectData.CompanyId,
                                projectId: projectData._id,
                                updateObject :updateObject
                            },
                            params : {
                                id :data.sprintId
                            }
                        }
                        if(data.folderObjId){
                            countObj.body.folder = {
                                folderId: data.folderObjId,
                                folderName: data.sprintArray.folderName
                            }
                        }
    
                        updateSprintFun(countObj).catch((error) => {
                            logger.error(`error in update task count : ${error}`)
                        });
    
                        if(!data.isParentTask) {
                            // UPDATE SUBTASK COUNT IF SUB TASK CREATED
                            let obj = [
                                {
                                    _id: new mongoose.Types.ObjectId(data.ParentTaskId)
                                }, {
                                    $inc: {
                                        subTasks: 1
                                    }
                                },
                                {returnDocument: "after"}
                            ]
                            let objSchema = {
                                type: data?.mainChat ? SCHEMA_TYPE.MAIN_CHATS : SCHEMA_TYPE.TASKS,
                                data: obj
                            }
    
                            MongoDbCrudOpration(projectData.CompanyId, objSchema, 'findOneAndUpdate').then((result)=>{
                                socketEmitter.emit('update', { type: "update", data: result , updatedFields: {subTasks: result.subTasks}, module: 'task' });
                            }).catch(error => {
                                logger.error(`ERROR in update parent task: ${projectData?._id||data?.ProjectID}> ${data.id} : ${error.message}`);
                            })
                        }
    
                        this.updateTaskKey({
                            companyId: projectData.CompanyId,
                            projectCode: projectData.ProjectCode,
                            projectId: data.ProjectID,
                            taskId: taskResult.id,
                            taskTypeKey: data.TaskTypeKey,
                            sprintId: data.sprintId,
                            mainChat: data?.mainChat || false,
                            isParentTask: data.isParentTask,
                            indexObj: indexObj,
                        })
                        .catch((error) => {
                            logger.error(`ERROR in update task key: ${error.message}`);
                        })
    
                        if(data?.mainChat) return;
    
                        let taskObj = {
                            'ProjectName' : projectData.ProjectName,
                            'newTaskname' : data.TaskName
                        }
                        let notificationObject = {
                            'message': createTask(taskObj),
                            'key': 'task_create',
                        }
                        let changeData = {
                            'ProjectName' : projectData.ProjectName,
                            'taskName' : data.TaskName,
                            "previousDiscriptionText":"",
                            "textSimple":`${data.TaskName} task created`
                        };
                        HandleBothNotification({
                            type:'tasks',
                            userData: user,
                            companyId: projectData.CompanyId,
                            projectId: data.ProjectID,
                            taskId: taskResult.id,
                            folderId: data.folderObjId || "",
                            sprintId: data.sprintId,
                            object: notificationObject,
                            "changeType":"task-create",
                            "changeData":changeData
                        })
                        .catch((error) => {
                            logger.error(`ERROR in notification Task Create: ${error.message}`);
                        })
                    }
                    else{
                        resolve(taskResult);
                    }
                })
                .catch((error) => {
                    reject(error)
                })
            } catch (error) {
                reject(error)
            }
        });
    }

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
    }

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
    }

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
    }

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
    }

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
    }

    /* -------------- UPDATE TAGS -----------------*/
    updateTags({companyId, projectId, sprintId, taskId, tagId, operation}) {
        return new Promise((resolve, reject) => {
            try {

                if(!operation) {
                    reject(new Error("Please provide an operation"));
                    return;
                } else if(!['add', 'remove'].includes(operation)) {
                    reject(new Error("Please provide a valid operation"));
                    return;
                }

                const schema = SCHEMA_TYPE.TASKS
                let queryObj = {};
                let queryFilter;

                if (operation === "add") {
                    queryFilter = { _id: new mongoose.Types.ObjectId(taskId) };
                    queryObj.$addToSet = { tagsArray: tagId };
                } else {
                    queryFilter = { _id: new mongoose.Types.ObjectId(taskId) };
                    queryObj.$pull = { tagsArray: tagId };
                };

                let obj = {
                    type: schema,
                    data: [
                        queryFilter,
                        queryObj,
                        { upsert: true, returnDocument: 'after' }
                    ]
                }

                MongoDbCrudOpration(companyId, obj, "findOneAndUpdate").then((response) => {
                    socketEmitter.emit('update', { type: "update", data: response , updatedFields: {}, module: 'task' });
                    resolve({status: true, statusText: `Tag updated successfully`});
                });

            } catch (error) {
                reject(error);
            }
        })
    }

    /* -------------- UPDATE CHECKLISTS -----------------*/
    updateChecklists({ companyId, projectId, sprintId, taskId, operation, data = {}, historyObj: historyObject, taskData }) {
        return new Promise((resolve, reject) => {
            try {
                const schema = SCHEMA_TYPE.TASKS;
                let queryObj = buildQueryObject(operation, taskId, data, historyObject);
                let obj = { type: schema, data: queryObj };

                MongoDbCrudOpration(companyId, obj, "findOneAndUpdate").then((response)=>{
                    socketEmitter.emit('update', { type: "update", data: response , updatedFields: {checklistArray: response.checklistArray}, module: 'task' });
                    resolve({ status: true, statusText: "Checklist updated successfully" });

                    let historyData = buildHistoryObject(operation, historyObject);
                    // let notificationObject = buildNotificationObject(operation, historyObject);

                    if (historyData && Object.keys(historyData).length > 0) {
                        HandleHistory('task', companyId, projectId, taskId, {
                            message: historyData.message,
                            key: historyData.key,
                            sprintId: sprintId
                        }, { id: historyObject.userId }).catch(err => {
                            logger.error(`ERROR in history checklist: ${err}`);
                        });
                    }

                    // if (notificationObject && Object.keys(notificationObject).length > 0) {
                    //     HandleBothNotification({
                    //         type: 'tasks',
                    //         companyId,
                    //         projectId,
                    //         taskId,
                    //         folderId: taskData.folderObjId || "",
                    //         sprintId: taskData.sprintId,
                    //         object: notificationObject,
                    //         userData: { id: historyObject.userId }
                    //     }).catch((error)=>{
                    //         logger.error(`ERROR in notification checklist: ${error.message}`);
                    //     });
                    // }
                })

            } catch (error) {
                logger.error(`ERROR in update Checklist: ${JSON.stringify(error)}`);
                reject(error);
            }
        })
    }

    /* -------------- UPDATE ATTACHMENTS -----------------*/
    updateAttachments({companyId, sprintId, taskId, taskData, id = "", operation, data = {}, userData, projectData}) {
        return new Promise((resolve, reject) => {
            try {

                const schema = SCHEMA_TYPE.TASKS
                let queryObj = {};
                let queryFilter;

                if (operation === 'add') {
                    queryObj.$push = { attachments: data };
                    queryFilter = { _id: new mongoose.Types.ObjectId(taskId) };
                } else {
                    // Update the 'name' of the specific object in the 'settings' array matching the given 'key'
                    queryFilter = { 
                        _id: new mongoose.Types.ObjectId(taskId),
                    };
                    queryObj.$pull = { attachments: { id: data.id } };
                };

                let obj = {
                    type: schema,
                    data: [
                        queryFilter,
                        queryObj,
                        { upsert: true, returnDocument: 'after' }
                    ]
                }

                MongoDbCrudOpration(companyId, obj, "findOneAndUpdate").then((response) => {
                    socketEmitter.emit('update', { type: "update", data: response , updatedFields: {attachments: response.attachments}, module: 'task' });
                    resolve({status: true, statusText: "Attachment updated successfully"});

                    let historyObj = {};
                    let notificationObject = {};
                    if(operation === "add") {
                        historyObj = {
                            message: `<b>${userData.name}</b> has attached <b>${data.filename}</b> on <b>${sanitizeInput(taskData.TaskName)}</b>.`,
                            key: "Task_Attachment",
                            sprintId: taskData.sprintId,
                        }
                        notificationObject = {
                            message: taskAttachmentAdd({
                                'ProjectName': projectData.ProjectName,
                                'TaskName': taskData.TaskName,
                                'url': data.filename
                            }),
                            key: "task_attachments",
                        }
                    } else if(operation === "remove") {
                        historyObj = {
                            message: `<b>${data.filename}</b> removed from <b>${sanitizeInput(taskData.TaskName)}</b>&apos;s attchments.`,
                            key: "Task_Attachment_Remove",
                            sprintId: taskData.sprintId,
                        }
                        notificationObject = {
                            'message': taskAttachmentRemove({
                                'ProjectName': projectData.ProjectName,
                                'TaskName': taskData.TaskName,
                                'removeFileName': data.filename
                            }),
                            'key': 'task_attachments',
                        }
                    }
                    HandleHistory('task',companyId, projectData.id, taskId, historyObj, userData).catch((error) => {
                        logger.error("ERROR in update Attachment handle history: "+ JSON.stringify(error));
                    })

                    if(notificationObject && Object.keys(notificationObject).length > 0) {
                        HandleBothNotification({
                            type: 'tasks',
                            companyId,
                            projectId: projectData.id,
                            taskId: taskId,
                            folderId: taskData.folderObjId || "",
                            sprintId: taskData.sprintId,
                            object: notificationObject,
                            userData: userData
                        })
                        .catch((error) => {
                            logger.error("ERROR in update Attachment handle notification: "+ JSON.stringify(error));
                        })
                    }
                })
                .catch((error) => {
                    reject(error)
                })
            } catch (error) {
                reject(error);
            }
        })
    }

    /* -------------- UPDATE DESCRIPTION -----------------*/
    updateDescription({companyId, task, text}) {
        return new Promise((resolve, reject) => {
            try {
                let description = text.blocks;
                const schema = SCHEMA_TYPE.TASKS
                let updateObj = { 
                    descriptionBlock: description,
                    rawDescription: text.text
                }
                let obj = {
                    type: schema,
                    data: [
                        {
                            _id: new mongoose.Types.ObjectId(task._id)
                        },
                        { 
                            ...updateObj
                        },
                        { returnDocument: 'after'}
                    ]
                }

                MongoDbCrudOpration(companyId, obj, "findOneAndUpdate").then((result) => {
                    socketEmitter.emit('update', { type: "update", data: result , updatedFields: updateObj, module: 'task' });
                    resolve({status: true, statusText: "Description updated successfully"});
                })
            } catch (error) {
                logger.error(`Update Discription Error:${error.message}`)
                reject(error);
            }
        })
    }

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
    }

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
    }

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
    }

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
    }

    mergeTask({companyId, projectData, taskId, mergeTaskId,oldProject,isSubTask,userData}) {
        return new Promise((resolve, reject) => {
            try {
                let object = {
                    type: dbCollections.TASKS,
                    data: [{ _id : new mongoose.Types.ObjectId(taskId)}]
                }
                MongoDbCrudOpration(companyId,object,"findOne")
                .then(async(task) => {
                    let query = {
                        type: dbCollections.TASKS,
                        data: [{ _id : new mongoose.Types.ObjectId(mergeTaskId)}]
                    }
                    await MongoDbCrudOpration(companyId,query,"findOne")
                    .then((mergeTask) => {
                        /* Soft delete task */
                        let deletedObj = {
                            type: SCHEMA_TYPE.TASKS,
                            data: [
                                {
                                    _id: new mongoose.Types.ObjectId(task._id)
                                },
                                {
                                    $set: {deletedStatusKey : 1}
                                },
                                {
                                    returnDocument: 'after'
                                }
                            ]
                        }
                        MongoDbCrudOpration(companyId,deletedObj,"findOneAndUpdate").then((result)=>{
                            socketEmitter.emit('update', { type: "update", data: result , updatedFields: {deletedStatusKey: result.deletedStatusKey}, module: 'task' });
                        })

                        let finalAttach = mergeTask.attachments ? mergeTask.attachments : [];
                        finalAttach = finalAttach.concat(task.attachments || []);
                        let firstDEs = mergeTask.description !== undefined ? `${mergeTask.TaskName} :  ${mergeTask.description}` : '';
                        let secondDes = task.description !== undefined ? `${task.TaskName} :  ${task.description}` : '';
                        let firstRawDes = mergeTask.rawDescription !== undefined ? `${mergeTask.TaskName} :  ${mergeTask.rawDescription}` : '';
                        let secondRawDes = task.rawDescription !== undefined ? `${task.TaskName} :  ${task.rawDescription}` : '';
                        let finalCheckList = mergeTask.checklistArray ? mergeTask.checklistArray : [];
                        finalCheckList = finalCheckList.concat(task.checklistArray || []);
                        let des1 = mergeTask.descriptionBlock !== undefined ? mergeTask.descriptionBlock : {time: 0, blocks: [], version: 0};
                        let des2 = task.descriptionBlock !== undefined ? task.descriptionBlock : {time: 0, blocks: [], version: 0};
                        let mergedObject = {
                            time: des1.time !== 0 ? des1.time : des2.time,
                            blocks: [...des1.blocks, ...des2.blocks],
                            version: des1.version !== 0 ? des1.version : des2.version
                        };
                        let mergeObj = {
                            attachments: finalAttach,
                            checklistArray:finalCheckList
                        }
                        if(firstDEs !== '' || secondDes !== ''){
                            let finalDescription = `${firstDEs !== '' ? `${firstDEs} <br>` : ''} ${secondDes}`
                            mergeObj.description = finalDescription
                        }
                        if(firstRawDes !== '' || secondRawDes !== ''){
                            let finalRowDescription = `${firstRawDes !== '' ? `${firstRawDes} <br>` : ''} ${secondRawDes}`
                            mergeObj.rawDescription = finalRowDescription
                        }
                        if(des1.blocks.length > 0 || des2.blocks.length > 0){
                            mergeObj.descriptionBlock = mergedObject;
                        }
                        let updateObj = {
                            type: SCHEMA_TYPE.TASKS,
                            data: [
                                {
                                    _id: new mongoose.Types.ObjectId(mergeTask._id)
                                },
                                {
                                    $set: {...mergeObj}
                                },
                                {
                                    returnDocument: 'after'
                                }
                            ]
                        }
                        MongoDbCrudOpration(companyId,updateObj,'findOneAndUpdate').then((result) => {
                            socketEmitter.emit('update', { type: "update", data: result , updatedFields: mergeObj, module: 'task' });
                            // resolve();
                        }).catch((err)=>{
                            logger.error(`${err}:"Error in Updating Doc Merge Task"`)
                        })
                        removeCommentCount(companyId,task.ProjectID,task.sprintId,task._id,task.ParentTaskId).catch((error) => {
                            logger.error(`${error} ERROR IN REMOVE COMMENT COUNT`);
                        })
                        updateHistoryCollection(companyId, task,projectData,mergeTask._id);
                        updateTimesheetCollection(companyId, task,projectData,mergeTask._id);
                        updateEstimatedTimeCollection(companyId, task,projectData,mergeTask._id);
                        let sprintObj = {
                            id : mergeTask.sprintId
                        }
                        updateCommentCollection(companyId, task,sprintObj,projectData,mergeTask._id)
                        if(task.isParentTask === false){
                            /*When a subtask is merged with another task, at that moment, the parent task of the subtask decreases by one.*/
                            let object = {
                                type:SCHEMA_TYPE.TASKS,
                                data: [
                                    { _id: new mongoose.Types.ObjectId(task.ParentTaskId)},
                                    {$inc: {"subTasks": -1}},
                                    {returnDocument: 'after'}
                                ]
                            }
                            MongoDbCrudOpration(companyId, object, "findOneAndUpdate").then((result)=>{
                                socketEmitter.emit('update', { type: "update", data: result , updatedFields: {subTasks: result.subTasks}, module: 'task' });
                            })
                        }
                        if(mergeTask.sprintId !== task.sprintId || JSON.parse(JSON.stringify(mergeTask)).ProjectID !== JSON.parse(JSON.stringify(task)).ProjectID){
                            const decObj = {
                                body: {
                                    companyId: companyId,
                                    projectId: oldProject.id,
                                    folderId: task?.folderObjId || null,
                                    updateObject :{$inc: { tasks: -1}},
                                },
                                params : {
                                    id : task.sprintId
                                }
                            }
                            updateSprintFun(decObj).catch((error) => {
                                logger.error(`error in update task count : ${error}`)
                            });
                        }
                        // When Task has child task //
                        if(isSubTask === true){
                            let subTaskArray = [];
                            let subObj = {
                                type: SCHEMA_TYPE.TASKS,
                                data: [
                                    {
                                        ProjectID: new mongoose.Types.ObjectId(oldProject.id),
                                        sprintId: new mongoose.Types.ObjectId(task.sprintId),
                                        isParentTask : false,
                                        ParentTaskId:task._id,
                                        deletedStatusKey: { $nin: [1] }
                                    }
                                ]
                            }
                            MongoDbCrudOpration(companyId,subObj,'find')
                            .then(async(result) => {
                                subTaskArray = result;
                                let promisesArr = [];
                                subTaskArray.forEach((stask) => {
                                    promisesArr.push(
                                        new Promise(async(resolve1, reject1) => {
                                            try {
                                                mergeSubTask(companyId, stask, mergeTask,projectData,oldProject).then(() => {
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
                                    resolve({status: true, statusText: "merge Task successfully",sprintCount: subTaskArray.length + 1});
                                }).catch((error) => {
                                    reject(error);
                                })
                            })
                        }else{
                            resolve({status: true, statusText: "merge Task successfully",sprintCount: 1});
                            const historyObj = {
                                key: "Task_Merge",
                                sprintId: mergeTask.sprintId,
                                mainChat: false
                            }
                            if(task.sprintId === mergeTask.sprintId){
                                historyObj.message = `<b>${userData.Employee_Name}</b> has merged the <b>${sanitizeInput(task.TaskName)}</b> task in to <b>${sanitizeInput(mergeTask.TaskName)}</b> task ${isSubTask === true ? '<b>with all its sub tasks</b>' : ''}.`
                            }else if(task.sprintId !== mergeTask.sprintId && JSON.parse(JSON.stringify(task))?.ProjectID === JSON.parse(JSON.stringify(mergeTask))?.ProjectID){
                                historyObj.message = `<b>${userData.Employee_Name}</b> has merged the <b>${sanitizeInput(task.TaskName)}</b> task of <b>(${task.folderObjId ?  task.sprintArray.folderName + '/' : ''}${task.sprintArray.name})</b> sprint in to <b>${sanitizeInput(mergeTask.TaskName)}</b> task <b>(${mergeTask.folderObjId ? mergeTask.sprintArray.folderName + '/'  : ''}${mergeTask.sprintArray.name})</b>${isSubTask === true ? '<b>with all its sub tasks</b>' : ''}.`
                            }else{
                                historyObj.message = `<b>${userData.Employee_Name}</b> has merged the <b>${sanitizeInput(task.TaskName)}</b> task of <b>(${sanitizeInput(oldProject.ProjectName)}${task.folderObjId ? '/' + task.sprintArray.folderName : ''}/${task.sprintArray.name})</b> sprint in to <b>${sanitizeInput(mergeTask.TaskName)}</b> task <b>(${sanitizeInput(projectData.ProjectName)}${mergeTask.folderObjId ? '/' + mergeTask.sprintArray.folderName : ''}/${mergeTask.sprintArray.name})</b> ${isSubTask === true ? '<b>with all its sub tasks</b>' : ''}.`
                            }
                            HandleHistory('task', companyId, projectData.id, mergeTask._id, historyObj, userData);
                        }
                    })
                })

            } catch (error) {
                reject(error)
            }
        })
    }
    async duplicateTask({companyId, projectData, sprintObj, selectedTaskId, oldProject,userData,isSubTask,duplicateData,assignee,watcher,taskName,oldSprintObj}){
        return new Promise((resolve, reject) => {
            try {
                let object = {
                    type: dbCollections.TASKS,
                    data: [{ _id : new mongoose.Types.ObjectId(selectedTaskId)}]
                }
                MongoDbCrudOpration(companyId,object,"findOne").then((selectedTask) => {
                    selectedTask.AssigneeUserId = duplicateData.includes('Copy Assignees') ? assignee : [];
                    selectedTask.watchers = duplicateData.includes('Copy Watchers') ? watcher : [];
                    let obj = {};
                    let parsedMap = JSON.parse(JSON.stringify(selectedTask))
                    if(JSON.parse(JSON.stringify(selectedTask))?.ProjectID !== projectData.id) {
                        let Ind = oldProject.taskStatusData.findIndex((x) => {return x.key === selectedTask.statusKey});
                        let typeInd = oldProject.taskTypeCounts.findIndex((x) => {return x.value === selectedTask.TaskType});
                        let statusData = oldProject.taskStatusData[Ind];
                        let typeData = oldProject.taskTypeCounts[typeInd];
                        obj = {
                            ...parsedMap,
                            TaskName: taskName!== '' ? taskName : selectedTask._doc.TaskName,
                            ProjectID: projectData.id,
                            sprintId: sprintObj.id,
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
                            isParentTask : true,
                            ParentTaskId : '',
                            attachments: duplicateData.includes('Attachments') ? selectedTask.attachments || [] : [],
                            DueDate: duplicateData.includes('Due Date') && selectedTask.DueDate !== null && selectedTask.DueDate !== undefined && selectedTask.DueDate !== 0 ? new Date(selectedTask.DueDate) || null: null,
                            dueDateDeadLine: duplicateData.includes('Due Date') && selectedTask.dueDateDeadLine && selectedTask.dueDateDeadLine.length ? selectedTask.dueDateDeadLine.map((x) => ({date: x && x.date? new Date(x.date) : ''})) : [],
                            checklistArray : duplicateData.includes('Checklists') && selectedTask.checklistArray ? selectedTask.checklistArray : []
                        }
                    }
                    else{
                        obj = {
                            ...parsedMap,
                            TaskName: taskName!== '' ? taskName : selectedTask._doc.TaskName,
                            ProjectID: selectedTask.ProjectID,
                            sprintId: sprintObj.id,
                            sprintArray : sprintObj,
                            isParentTask : true,
                            ParentTaskId : '',
                            attachments: [],
                            DueDate: duplicateData.includes('Due Date') && selectedTask.DueDate !== undefined && selectedTask.DueDate !== null ? new Date(selectedTask.DueDate) || null: null,
                            dueDateDeadLine: duplicateData.includes('Due Date') && selectedTask.dueDateDeadLine && selectedTask.dueDateDeadLine.length ? selectedTask.dueDateDeadLine.map((x) => ({date: x && x.date ? new Date(x.date) : ''})) : [],
                            checklistArray : duplicateData.includes('Checklists') && selectedTask.checklistArray ? selectedTask.checklistArray : []
                        }
                    }
                    if(sprintObj.folderId){
                        obj.folderObjId = sprintObj.folderId;
                    }else{
                        delete obj.folderObjId;
                    }
                    delete obj._id;
                    let indexObj = {
                        indexName : "groupByStatusIndex",
                        searchKey : "statusKey",
                        searchValue : "1"
                    }
                    let projectObj = {
                        type:SCHEMA_TYPE.PROJECTS,
                        data: [
                            { _id : new mongoose.Types.ObjectId(obj.ProjectID)},
                            {$inc: {
                                'taskTypeCounts.$[elementIndex].taskCount': 1,
                                lastTaskId:1
                            }},
                            {
                                arrayFilters: [
                                    { "elementIndex.key": obj.TaskTypeKey}
                                ],
                                returnDocument: 'after'
                            }
                        ]
                    }
                    MongoDbCrudOpration(companyId, projectObj, "findOneAndUpdate").then((response) => {
                        socketEmitter.emit('update', { type: "update", data: response , updatedFields: {taskTypeCounts: response.taskTypeCounts,lastTaskId: response.lastTaskId}, module: 'task' });
                        obj.TaskKey = projectData.ProjectCode + '-' +  response.lastTaskId;
                        HandleTask(companyId, obj, false, null, userData,indexObj)
                        .then((taskResult) => {
                            if(taskResult.status){
                                resolve({status: true, statusText: "Duplicate Task Added",taskId :taskResult.id });
                                // UPDATE TASK COUNT IN SPRINT                                
                                if(duplicateData.includes('Attachments')){
                                    if(selectedTask.attachments.length > 0) {
                                        let promises = [];

                                        selectedTask.attachments.forEach((x) => {
                                            const previousUrl = x.url;
                                            let lastSlashIndex = previousUrl.lastIndexOf('/');
                                            let fileName = previousUrl.substring(lastSlashIndex + 1);
                                            x.url = `Project/${projectData.id}/Sprint/${taskResult.id}/Attachment/${fileName}`;

                                            promises.push(handleTaskAttachmentsDuplicateFunctionality(companyId, previousUrl, x.url));
                                        });
                                        Promise.allSettled(promises).then(() => {
                                            let updateObj = {
                                                type: SCHEMA_TYPE.TASKS,
                                                data: [
                                                    {
                                                        _id: new mongoose.Types.ObjectId(taskResult.id)
                                                    },
                                                    {
                                                        $set: {attachments : selectedTask.attachments}
                                                    },
                                                    {
                                                        returnDocument: 'after'
                                                    }
                                                ]
                                            }
                                            MongoDbCrudOpration(companyId, updateObj, "findOneAndUpdate").then((result)=>{
                                                socketEmitter.emit('update', { type: "update", data: result , updatedFields: {attachments: result.attachments}, module: 'task' });
                                            })
                                        })
                                    }
                                }
                                let updateObject = {
                                    $inc: { tasks: 1}
                                }
                                const countObj = {
                                    body: {
                                        companyId: companyId,
                                        projectId: projectData.id,
                                        updateObject :updateObject
                                    },
                                    params : {
                                        id :obj.sprintId
                                    }
                                }
                                if(obj.folderObjId){
                                    countObj.body.folder = {
                                        folderId: obj.folderObjId,
                                        folderName: obj.sprintArray.folderName
                                    }
                                }

                                updateSprintFun(countObj).catch((error) => {
                                    logger.error(`error in update task count : ${error}`)
                                });
                                const historyObj = {
                                    key: "Task_Duplicated",
                                    sprintId: sprintObj.id,
                                    mainChat: false
                                }
                                if(JSON.parse(JSON.stringify(selectedTask))?.ProjectID !== projectData.id){
                                    historyObj.message = `<b>${userData.Employee_Name}</b> has duplicated <b>${sanitizeInput(obj.TaskName)}</b> task from <b>(${sanitizeInput(oldProject.ProjectName)}${oldSprintObj.folderId ? '/' + oldSprintObj.folderName : ''}/${oldSprintObj.name})</b> to <b>(${sanitizeInput(projectData.ProjectName)}${sprintObj.folderId ? '/' + sprintObj.folderName : ''}/${sprintObj.name})</b> project ${isSubTask === true ? '<b>with all its sub tasks</b>' : ''}.`
                                }else{
                                    historyObj.message = `<b>${userData.Employee_Name}</b> has duplicated <b>${sanitizeInput(obj.TaskName)}</b> task from <b>(${oldSprintObj.folderId ?  oldSprintObj.folderName + '/' : ''}${oldSprintObj.name})</b> to <b>(${sprintObj.folderId ? sprintObj.folderName + '/'  : ''}${sprintObj.name})</b> sprint ${isSubTask === true ? '<b>with all its sub tasks</b>' : ''}.`
                                }
                                HandleHistory('task', companyId, projectData.id,taskResult.id, historyObj, userData);
                                try {
                                    if(duplicateData.includes('Activity')){
                                        addHistoryCollection(companyId, projectData,selectedTask,taskResult,sprintObj).catch((err) => {
                                            logger.error(`ERROR IN ADD HISTORY:${err}`)
                                        })
                                    }
                                    if(duplicateData.includes('Comments')){
                                        addCommentCollection(companyId, projectData,selectedTask,taskResult,sprintObj)
                                        .catch((error) => {
                                            logger.error(`ERROR IN ADD COMMENTS:${error}`)
                                        })
                                    }
                                } catch (error) {
                                    logger.error(`${error}ERROR in create task in typesense collection: `);
                                }
                                let subTaskArray = [];
                                if(isSubTask  === true){
                                    let object = {
                                        type: dbCollections.TASKS,
                                        data: [{
                                            ProjectID: new mongoose.Types.ObjectId(oldProject.id),
                                            sprintId: new mongoose.Types.ObjectId(selectedTask.sprintId),
                                            isParentTask: false,
                                            ParentTaskId: selectedTask._id,
                                            deletedStatusKey: { $nin: [1] }
                                        }]
                                    }
                                    MongoDbCrudOpration(companyId,object,"find").then((subTasks) => {
                                        subTaskArray = subTasks;
                                        let arrayOfObjects = []
                                        const objectCount = Math.ceil(subTaskArray.length / 7);
                                        for (let i = 0; i < objectCount; i++) {
                                            const startIndex = i * 7;
                                            const endIndex = startIndex + 7;
                                            const documentsSlice = subTaskArray.slice(startIndex, endIndex);
                                    
                                            arrayOfObjects.push(documentsSlice);
                                        }
                                        let count = 0;
                                        let countFunction = async(row) => {
                                            try {
                                                if(count >= Object.keys(arrayOfObjects).length) {
                                                    resolve({status: true, statusText: "subtask merged successfully"});
                                                    return;
                                                }else{
                                                    let promise = [];
                                                    row.forEach((stask)=>{
                                                        promise.push(duplicateSubTaskFunction(companyId, projectData, sprintObj, stask, taskResult.id,userData, oldProject,duplicateData));
                                                    })
                                                    Promise.allSettled(promise).then((res)=>{
                                                        count++;
                                                        countFunction(arrayOfObjects[Object.keys(arrayOfObjects)[count]]);
                                                    }).catch((error)=>{
                                                        logger.error(error);
                                                        count++;
                                                        countFunction(arrayOfObjects[Object.keys(arrayOfObjects)[count]]);
                                                    })
                                                }
                                            } catch (error) {
                                                logger.error(`${error}ERROR in count function`);
                                            }
                                        }
                                        countFunction(arrayOfObjects[Object.keys(arrayOfObjects)[count]]);
                                    })
                                }
                            }else{
                                resolve(taskResult);
                            }
                        }).catch((error) => {
                            reject(error);
                            logger.error(`${error}ERROR IN CRETE TASK `)
                        })
                    })
                })
            } catch (error) {
                logger.error(`${error}ERROR IN DUPLICATE TASK FUNCTIONALITY.`);
                reject(error);
            }
        })
    }

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
    }

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
    }

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
    }

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

    updateSupportTicket({companyId,updateObj,taskId}) {
        return new Promise((resolve,reject) => {
            try {
                const query = {
                    type: dbCollections.TASKS,
                    data: [
                        {
                            _id: new mongoose.Types.ObjectId(taskId)
                        }, 
                        {
                            $set: {
                                ...updateObj,
                            },
                        }
                    ]
                }

                MongoDbCrudOpration(companyId, query, "updateOne")
                .then(() => {
                    resolve({status: true, statusText: "Ticket Update Successfully"});
                })
                .catch((error) => {
                    logger.error(`ERROR in task status: ${error.message}`);
                    reject(error)
                })
            } catch (error) {
                logger.error(`ERROR in task status : ${error.message}`);
                reject(error)
            }
        })
    }

    createSubTaskWithAi({companyId,userId,subTitles,sprintObj,projectData,userData,parentTask,type}) {
        return new Promise((resolve,reject) => {
            try {
                let tasksArray = []
                subTitles.map((sub) => {
                    let obj = {
                        'TaskName': sub.title,
                        'TaskKey': '-',
                        'AssigneeUserId': [],
                        'watchers': [],
                        'DueDate': '',
                        'dueDateDeadLine': [],
                        'TaskType': 'task',
                        'TaskTypeKey': 1,
                        'ParentTaskId': type === 'subTask' ? parentTask.id : '',
                        'ProjectID': parentTask.ProjectID,
                        'CompanyId': companyId,
                        'status': {
                            "text": 'To Do',
                            "key": 1,
                            'type': 'default_active'
                        },
                        'isParentTask': type === 'subTask' ? false : true,
                        'Task_Leader': userId,
                        'sprintArray': sprintObj,
                        'Task_Priority': 'MEDIUM',
                        'deletedStatusKey': 0,
                        'sprintId': sprintObj.id,
                        'statusType': 'default_active',
                        'statusKey': 1,
                        '_id': new mongoose.Types.ObjectId(),
                    }
                    if (sprintObj.folderId) {
                        obj.folderObjId = new mongoose.Types.ObjectId(sprintObj.folderId);
                    }
                    tasksArray.push(obj);
                });
                resolve(tasksArray);
                let count = 0;
                const countFun = (obj) => {
                    if(count >= tasksArray.length) {
                        return;
                    } else {
                        let indexObj;
                        indexObj = {
                            indexName : "groupByStatusIndex",
                            searchKey : "statusKey",
                            searchValue : "1"
                        }
                        this.create({data: obj, user: userData, projectData, indexObj})
                        .then(() => {
                            count++;
                            countFun(tasksArray[count]);
                        })
                        .catch((error) => {
                            console.error("ERROR in create task: ", error);
                            count++;
                            countFun(tasksArray[count]);
                        })
                    }
                }
                countFun(tasksArray[count]);
            } catch (error) {
                logger.error(`ERROR in create sub task : ${error.message}`);
                reject(error);
            }
        })
    }

    updateTaskCustomField({companyId,taskId,updateDetail,customFieldId}) {
        return new Promise((resolve,reject) => {
            try {
                const query = {
                    type: dbCollections.TASKS,
                    data: [
                        { _id: new mongoose.Types.ObjectId(taskId) },
                        { 
                            $set: { [`customField.${customFieldId}`]: updateDetail }
                        },
                        {returnDocument: 'after'}
                    ]
                }

                MongoDbCrudOpration(companyId, query, "findOneAndUpdate")
                .then((result) => {
                    socketEmitter.emit('update', { type: "update", data: result , updatedFields: {[`customField.${customFieldId}`]: updateDetail}, module: 'task' });
                    resolve({status: true,data: result, statusText: "Custom Field Update Successfully"});
                })
                .catch((error) => {
                    logger.error(`Error in Updating Custom Field: ${error.message}`);
                    reject(error)
                })
            } catch (error) {
                logger.error(`Error in Updating Custom Field : ${error.message}`);
                reject(error)
            }
        })
    }

    updateMarkAsFavourite({companyId,taskId,updateDetail,type}) {
        return new Promise((resolve,reject) => {
            try {                
                const requiredFields = { updateDetail,taskId,type,companyId };
                const missingField = Object.keys(requiredFields).find(key => !requiredFields[key]);
                if (missingField) {
                    return reject({ message: `${missingField} is required.` });
                }

                let key
                if(type === "add") {
                    key = "$push"
                } else {
                    key = "$pull"
                }
                const query = {
                    type: dbCollections.TASKS,
                    data: [
                        { _id: new mongoose.Types.ObjectId(taskId) },
                        { [key]:{
                            favouriteTasks: updateDetail
                        } },
                        {returnDocument: 'after'}
                    ]
                }

                MongoDbCrudOpration(companyId, query, "findOneAndUpdate")
                .then((result) => {
                    socketEmitter.emit('update', { type: "update", data: result , updatedFields: { favouriteTasks: result.favouriteTasks }, module: 'task' });
                    resolve({status: true,data: result, statusText: "Custom Field Update Successfully"});
                })
                .catch((error) => {
                    logger.error(`Error in Updating Custom Field: ${error.message}`);
                    reject(error)
                })
            } catch (error) {
                logger.error(`Error in Updating Custom Field : ${error.message}`);
                reject(error)
            }
        })
    }

    updateLastMessageTime({ companyId, taskId, msgObj }) {
        return new Promise((resolve, reject) => {
            try {
                const convertMsgObj = replaceObjectKey(msgObj,"objId");      
                let updatedObj = {
                    lastMessage: new Date(),
                    ...(Object.keys(convertMsgObj || {}).length ? ["text", "link"].includes(convertMsgObj.type) ? { message: convertMsgObj.message } : { message: convertMsgObj.mediaOriginalName } : {})
                }          
                const query = {
                    type: SCHEMA_TYPE.TASKS,
                    data: [
                        {
                            _id: new mongoose.Types.ObjectId(taskId)
                        },
                        {
                            $set: updatedObj
                        },
                        {
                            returnDocument: 'after'
                        }
                    ]
                }

                MongoDbCrudOpration(companyId, query, "findOneAndUpdate").then((response) => {
                    socketEmitter.emit('update', { type: "update", data: response , updatedFields: updatedObj, module: 'task' });
                    resolve({ status: true });
                })
                .catch((error) => {
                    logger.error(`Error in updating updateLastMessageTime in task class: ${error.message}`);
                    reject(error)
                })
            } catch (error) {
                logger.error(`Error in updating updateLastMessageTime in task class: ${error.message}`);
                reject(error)
            }
        })
    }

    AddAiChecklist({companyId,taskId,checklistArray,userData,sprintId,projectId}){
        return new Promise((resolve, reject) => {
            try {
                let object = {
                    type: dbCollections.TASKS,
                    data: [
                        { _id: new mongoose.Types.ObjectId(taskId) },
                        { $push: {
                                checklistArray:  {
                                    $each: [
                                        ...checklistArray
                                    ]
                                }
                            }
                        },
                        {
                            returnDocument: 'after'
                        }
                    ]
                }
                MongoDbCrudOpration(companyId, object, "findOneAndUpdate").then((response) => {
                    resolve({status: true, statusText: "Checklist added successfully"});
                    socketEmitter.emit('update', { type: "update", data: response , updatedFields: {checklistArray: checklistArray}, module: 'task' });
                })
                .catch((error) => {
                    logger.error(`Error in Adding Checklist: ${error.message}`);
                    reject(error)
                })
                const names = checklistArray.map(item => item.name).join(", ");

                let historyObj = {
                    key: "task_checklist",
                    message: `<b>${userData.Employee_Name}</b> has created new checklist item <b class="text-ellipsis vertical-middle d-inline-block" style="max-width:150px" title="${names}">${names}</b>`,
                    sprintId: sprintId
                };
                HandleHistory('task',companyId,projectId,taskId,historyObj,userData)

            } catch (error) {
                logger.error(`ERROR in Adding Checklist: ${JSON.stringify(error)}`);
                reject(error);
            }
        })
    }
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

    createMultipleTasks({ tasks, userData, projectData, indexObj, statusArray, sprint, eventId }) {
        return new Promise((resolve, reject) => {
            // Check if any task contains a custom field
            const hasCustomFields = tasks.some(task => Object.keys(task).some(key => key.startsWith("custom_")));
            let createdCustomFields;
            // Function to handle actual task creation logic
            const processTasks = (tasks) => {
                const parentTasks = tasks.filter(task => !task.ParentTaskId || task.ParentTaskId === "");
                const subtasks = tasks.filter(task => task.ParentTaskId && task.ParentTaskId !== "");
                const totalTasks = parentTasks.length + subtasks.length;
    
                const idMapping = {};
                const statusMapping = statusArray.reduce((acc, status) => {
                    acc[status.name] = { key: status.key, type: status.type };
                    return acc;
                }, {});
    
                let completedTasks = 0;
    
                const updateProgress = () => {
                    const progress = Math.round((completedTasks / totalTasks) * 100);
                    emitListener(eventId, { step: progress });
                };
    
                const parentPromises = parentTasks.map((task) => {
                    const statusDetails = statusMapping[task.status];
                    const parentTaskObj = {
                        'TaskName': task.TaskName.trim(),
                        'TaskKey': '-',
                        'AssigneeUserId': task.AssigneeUserId || [],
                        'watchers': task.watchers || [],
                        'DueDate': task.DueDate || null,
                        'startDate': task.startDate || null,
                        'dueDateDeadLine': task.dueDateDeadLine || [],
                        'TaskType': task.TaskType || "task",
                        'TaskTypeKey': task.TaskTypeKey || 1,
                        'ParentTaskId': "",
                        'ProjectID': projectData._id,
                        'CompanyId': projectData.CompanyId,
                        'status': {
                            "text": task.status || 'To Do',
                            "key": statusDetails.key,
                            'type': statusDetails.type
                        },
                        'isParentTask': true,
                        'Task_Leader': task.Task_Leader,
                        'Task_Priority': task.Task_Priority || 'Medium',
                        'deletedStatusKey': task.deletedStatusKey || 0,
                        'sprintId': sprint.id,
                        'statusType': statusDetails.type,
                        'statusKey': statusDetails.key,
                        'sprintArray': sprint,
                        'customField': task.customField || {},
                        'descriptionBlock': task.descriptionBlock || {},
                    };
                    if(sprint.folderId) {
                        parentTaskObj.folderObjId = sprint.folderId;
                    }
    
                    return this.create({
                        data: parentTaskObj,
                        user: userData,
                        projectData,
                        indexObj,
                        setNotif: true
                    }).then(taskResult => {
                        idMapping[task._id] = taskResult.id;
                        completedTasks++;
                        updateProgress();
                    })
                });
    
                Promise.all(parentPromises).then(() => {
                    const subtaskPromises = subtasks.map((task) => {
                        const statusDetails = statusMapping[task.status];
                        const subTaskObj = {
                            'TaskName': task.TaskName.trim(),
                            'TaskKey': '-',
                            'AssigneeUserId': task.AssigneeUserId || [],
                            'watchers': task.watchers || [],
                            'DueDate': task.DueDate || null,
                            'startDate': task.startDate || null,
                            'dueDateDeadLine': task.dueDateDeadLine || [],
                            'TaskType': task.TaskType || "task",
                            'TaskTypeKey': task.TaskTypeKey || 1,
                            'ParentTaskId': idMapping[task.ParentTaskId] || "",
                            'ProjectID': projectData._id,
                            'CompanyId': projectData.CompanyId,
                            'status': {
                                "text": task.status || 'To Do',
                                "key": statusDetails.key,
                                'type': statusDetails.type
                            },
                            'isParentTask': false,
                            'Task_Leader': task.Task_Leader,
                            'Task_Priority': task.Task_Priority || 'Medium',
                            'deletedStatusKey': task.deletedStatusKey || 0,
                            'sprintId': sprint.id,
                            'statusType': statusDetails.type,
                            'statusKey': statusDetails.key,
                            'sprintArray': sprint,
                            'customField': task.customField || {},
                            'descriptionBlock': task.descriptionBlock || {},
                        };
                        if(sprint.folderId) {
                            subTaskObj.folderObjId = sprint.folderId;
                        }
    
                        return this.create({
                            data: subTaskObj,
                            user: userData,
                            projectData,
                            indexObj,
                            setNotif: true
                        }).then(() => {
                            completedTasks++;
                            updateProgress();
                        })
                    });
    
                    return Promise.all(subtaskPromises);
                }).then(() => {
                    resolve({ status: true, statusText: "Tasks created successfully", createdTasks: tasks, customFields: createdCustomFields });
                    emitListener(eventId, { step: "STOP" });
                }).catch(error => {
                    console.error("Error while creating tasks:", error);
                    reject(error);
                });
            };
    
            if (hasCustomFields) {
                createCustomFields({ tasks, userData, projectData })
                    .then(response => {
                        createdCustomFields = response.customFields;
                        processTasks(response.tasks)
                    })
                    .catch(error => {
                        console.error("Error while creating custom fields:", error);
                        reject(error);
                    });
            } else {
                processTasks(tasks);
            }
        });
    }


    updateTaskTotalEstimate({firebaseObj,projectData ,taskData , obj, userData}) {
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
                    updateRemainingTime(projectData.CompanyId,taskData._id);
                    resolve({status: true, statusText: "Task total estimate update successfully"});
                    const updatedDisplayText = convertToDisplayFormat(firebaseObj.totalEstimatedTime);
                    const previousDisplayText = convertToDisplayFormat(obj.previousEstimatedTime);
                    let editTaskObj = {
                        'TaskName' : taskData.TaskName,
                        'UserName': userData.Employee_Name,
                        'message' : updatedDisplayText
                    } 
                    let notificationObject = {
                        key: "task_total_estimate_edit",
                        message : taskTotalEstimate(editTaskObj),
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
                            changeType:'totalEstimate',
                            changeData: editTaskObj
                        })
                        .catch((error) => {
                            logger.error(`ERROR in notification: ${error.message}`);
                        });
                    }
                    let historyObj = {
                        key: "task_total_estimate",
                        message : `<b>${obj.userName}</b> has updated total estimated time from <b>${previousDisplayText}</b> to <b>${updatedDisplayText}</b>.`,
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
}


exports.taskMongo = new Task();
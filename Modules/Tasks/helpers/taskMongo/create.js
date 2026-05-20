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
    },

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
    },

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
};

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
const { hasFieldColumns, fieldsFromColumns } = require('../importedFields');
const { removeCache } = require('../../../../utils/commonFunctions.js');
const { updateRemainingTime } = require('../../../LogTime/controllerV2.js');
const { TaskWriteRefusal } = require('../taskWriteFields');
const { REFUSALS, PLACEMENT_FIELDS, slotUnder, levelRows } = require('../taskTree');
const { importMarkOf } = require('../importMark');

const treeRefusal = (code) => new TaskWriteRefusal(code === 'PARENT_NOT_FOUND' ? 404 : 400, REFUSALS[code], code);

/* The chain and the placement of a new row come from the stored parent and its root, never from
 * the caller. The caller's permission was judged in data.ProjectID, so a parent that would place
 * the row in another project answers as if it did not exist. */
const placeInTree = async (companyId, data) => {
    if (data.mainChat || !data.ParentTaskId) {
        data.ancestors = [];
        return;
    }
    const slot = await slotUnder(companyId, data.ParentTaskId);
    if (!slot.ok) throw treeRefusal(slot.code);
    if (String(slot.placement.ProjectID) !== String(data.ProjectID)) throw treeRefusal('PARENT_NOT_FOUND');
    PLACEMENT_FIELDS.forEach((field) => { delete data[field]; });
    Object.assign(data, slot.placement, { ancestors: slot.ancestors, isParentTask: false });
};

const importedDetails = (task) => ({
    ...(Array.isArray(task.tagsArray) && task.tagsArray.length ? { tagsArray: task.tagsArray } : {}),
    ...(Number.isFinite(task.totalEstimatedTime) && task.totalEstimatedTime > 0 ? { totalEstimatedTime: task.totalEstimatedTime } : {}),
});

module.exports = {
    /* `importMark` is handed over by the importers alone; the task routes drop it from a body. */
    create({data, user, projectData ,indexObj, setNotif, importMark = null}) {
        return new Promise((resolve,reject) => {
            try {
                placeInTree(projectData.CompanyId, data)
                .then(() => HandleTask(projectData.CompanyId, data, false, data.id || null, user, { importMark }))
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
                                socketEmitter.emit('update', { type: "update", data: result , updatedFields: {subTasks: result.subTasks}, module: 'task', companyId: projectData.CompanyId });
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
                const indexObj = { indexName: "groupByStatusIndex", searchKey: "statusKey", searchValue: "1" };
                // Answer once every task is written and name only those, so a caller can undo by the ids it gets back.
                const createAll = async () => {
                    const created = [];
                    for (const obj of tasksArray) {
                        try {
                            await this.create({data: obj, user: userData, projectData, indexObj});
                            created.push(obj);
                        } catch (error) {
                            if (error instanceof TaskWriteRefusal) throw error;
                            logger.error(`ERROR in create task: ${error && error.message}`);
                        }
                    }
                    return created;
                };
                createAll().then(resolve).catch(reject);
            } catch (error) {
                logger.error(`ERROR in create sub task : ${error.message}`);
                reject(error);
            }
        })
    },

    /* `importMark` and `storedParents` come from the importers alone; the task routes drop both from a body.
     * `storedParents` maps an id a row may name as its parent to a task already stored, so a row can go under it. */
    createMultipleTasks({ tasks, userData, projectData, indexObj, statusArray, sprint, eventId, importMark = null, storedParents = new Map() }) {
        return new Promise((resolve, reject) => {
            let createdCustomFields;
            let skippedFields = [];
            const processTasks = (tasks) => {
                const { levels: [parentTasks, ...subtaskLevels], parentIdOf, storedParentOf, adjusted } = levelRows(tasks, storedParents);
                const totalTasks = tasks.length;
    
                const idMapping = {};
                const statusMapping = statusArray.reduce((acc, status) => {
                    acc[status.name] = { key: status.key, type: status.type };
                    return acc;
                }, {});
    
                let completedTasks = 0;
                let droppedFieldValues = 0;

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
                        'rawDescription': task.rawDescription || '',
                        'checklistArray': task.checklistArray || [],
                        'attachments': task.attachments || [],
                        ...importedDetails(task),
                    };
                    if(sprint.folderId) {
                        parentTaskObj.folderObjId = sprint.folderId;
                    }
    
                    return this.create({
                        data: parentTaskObj,
                        user: userData,
                        projectData,
                        indexObj,
                        setNotif: true,
                        importMark: importMarkOf(importMark, task),
                    }).then(taskResult => {
                        idMapping[task._id] = taskResult.id;
                        task.createdTaskId = taskResult.id;
                        droppedFieldValues += taskResult.droppedFieldValues || 0;
                        completedTasks++;
                        updateProgress();
                    })
                });
    
                const createSubtask = (task) => {
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
                            'ParentTaskId': storedParentOf.get(task) || idMapping[parentIdOf.get(task)] || "",
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
                            'rawDescription': task.rawDescription || '',
                            'checklistArray': task.checklistArray || [],
                            ...importedDetails(task),
                        };
                        if(sprint.folderId) {
                            subTaskObj.folderObjId = sprint.folderId;
                        }
    
                        return this.create({
                            data: subTaskObj,
                            user: userData,
                            projectData,
                            indexObj,
                            setNotif: true,
                            importMark: importMarkOf(importMark, task),
                        }).then((taskResult) => {
                            idMapping[task._id] = taskResult.id;
                            task.createdTaskId = taskResult.id;
                            droppedFieldValues += taskResult.droppedFieldValues || 0;
                            completedTasks++;
                            updateProgress();
                        })
                };

                Promise.all(parentPromises)
                .then(() => subtaskLevels.reduce((created, level) => created.then(() => Promise.all(level.map(createSubtask))), Promise.resolve()))
                .then(() => {
                    resolve({ status: true, statusText: "Tasks created successfully", createdTasks: tasks, customFields: createdCustomFields, adjusted, droppedFieldValues, ...(skippedFields.length ? { skippedFields } : {}) });
                    emitListener(eventId, { step: "STOP" });
                }).catch(error => {
                    console.error("Error while creating tasks:", error);
                    reject(error);
                });
            };
    
            if (hasFieldColumns(tasks)) {
                fieldsFromColumns({ tasks, userData, projectData })
                    .then(response => {
                        createdCustomFields = response.customFields;
                        skippedFields = response.skippedFields || [];
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

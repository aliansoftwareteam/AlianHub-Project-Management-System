const { escapeHtml } = require('../../../../utils/escapeHtml');
const { dbCollections } = require('../../../../Config/collections')
const { sanitizeInput } = require("../../../serviceFunction");
const { HandleHistory,HandleTask,convertToSubTaskFunction, moveTaskFunction, convertToListSubTask,mergeSubTask, duplicateSubTaskFunction, addHistoryCollection, removeCommentCount,updateHistoryCollection, updateTimesheetCollection, updateEstimatedTimeCollection, carrySubtree} = require("../mongo_helper")

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
const { taskNotFound, plainIdOf, TaskWriteRefusal } = require('../taskWriteFields');
const keptAiValues = require('../../../AI/taskAiValues');
const { cascadeStatus, sprintCountChange, loadSubtree, storedTask, slotUnder } = require('../taskTree');
const { removeLinksOfTasks } = require('../../../CustomField/helpers/fieldLinkStore');
module.exports = {

    /* The counts, the parent and the current state come from the stored task; the body only says which task and which state it goes to. */
    /* `quiet` is set by the undo of an import alone, which trashes many tasks at once and notifies no one; the task
     * routes drop it from a body. */
    updateArchiveDelete({companyId, projectData, task, userData, deletedStatusKey = 0, quiet = false}) {
        return new Promise((resolve, reject) => {
            try {
                const taskId = plainIdOf(task && task._id).id;
                if (!taskId) {
                    reject(new TaskWriteRefusal(400, 'task._id must be an id.'));
                    return;
                }
                if (![0, 1, 2].includes(deletedStatusKey)) {
                    reject(new TaskWriteRefusal(400, 'deletedStatusKey must be 0, 1 or 2.'));
                    return;
                }
                const filter = { _id: new mongoose.Types.ObjectId(taskId) };
                MongoDbCrudOpration(companyId, { type: dbCollections.TASKS, data: [filter] }, "findOne").then((before) => {
                    if (!before) {
                        reject(taskNotFound());
                        return;
                    }
                    const projectId = String(before.ProjectID);
                    const sprintId = String(before.sprintId);
                    const from = before.deletedStatusKey || 0;
                    const query = {
                        type: dbCollections.TASKS,
                        data: [filter, { $set: { deletedStatusKey }, $unset: { cascadedBy: '' } }, { returnDocument: 'after' }]
                    }
                    return MongoDbCrudOpration(companyId, query, "findOneAndUpdate").then(async (result) => {
                        socketEmitter.emit('update', { type: "update", data: result , updatedFields: {deletedStatusKey}, module: 'task', companyId });
                        let carried = [];
                        try {
                            if(before.ParentTaskId && !from !== !deletedStatusKey) {
                                this.updateParentCount(companyId, before.ParentTaskId, deletedStatusKey ? -1 : 1);
                            }
                            carried = await cascadeStatus(companyId, before, deletedStatusKey);
                            carried.forEach((row) => {
                                socketEmitter.emit('update', { type: "update", data: row, updatedFields: {deletedStatusKey: row.deletedStatusKey}, module: 'task', companyId });
                                removeCommentCount(companyId,row.ProjectID,row.sprintId,row._id).catch((error) => {
                                    logger.error(`${error} ERROR IN REMOVE COMMENT COUNT`);
                                })
                            });
                            if(before.isParentTask && deletedStatusKey !== 0) {
                                const countResetData = {
                                    companyId : companyId,
                                    projectId,
                                    userIds: [...(result.AssigneeUserId || [])],
                                    "read": true,
                                    key: 2,
                                    taskId,
                                    sprintId
                                }
                                updateUnReadCommentsCountFun(countResetData)
                                .catch((error) => {
                                    logger.error(`ERORR in update parent count: ${error?.message}`);
                                })
                            }
                        } catch (error) {
                            logger.error(`ERORR in update parent count: ${error.message}`);
                        }
                        resolve({status: true, statusText: "deleteStatus updated successfully"});

                        const updateObject = sprintCountChange(from, deletedStatusKey, 1 + carried.length);
                        if(Object.keys(updateObject).length) {
                            const countObj = {
                                body: {
                                    companyId: companyId,
                                    projectId,
                                    updateObject: { $inc: updateObject }
                                },
                                params : {
                                    id : sprintId
                                }
                            }
                            if(before.folderObjId){
                                countObj.body.folder = {
                                    folderId: before.folderObjId,
                                    folderName: (before.sprintArray && before.sprintArray.folderName) || ""
                                }
                            }

                            updateSprintFun(countObj).catch((error) => {
                                logger.error(`error in update task count : ${error}`)
                            });
                        }
                        removeCommentCount(companyId,before.ProjectID,before.sprintId,before._id,before.ParentTaskId).catch((error) => {
                            logger.error(`${error} ERROR IN REMOVE COMMENT COUNT`);
                        })

                        try {
                            const verb = deletedStatusKey === 0 ? 'restored' : deletedStatusKey === 1 ? 'deleted' : 'archieved';
                            const projectName = sanitizeInput(String((projectData && projectData.ProjectName) || ''));
                            let historyObj = {
                                message: `<b>${userData.Employee_Name}</b> has ${verb} <b>${sanitizeInput(before.TaskName)}</b> task in <b>${escapeHtml(projectName)}</b> project.`,
                                key: "task_delete",
                                sprintId: before.sprintId,
                            }

                            let notificationObject = {
                                'type': 'task',
                                'key': 'task_delete',
                                'message': `<strong>${userData.Employee_Name}</strong> has ${verb} <strong>${sanitizeInput(before.TaskName)}</strong> task in <strong>${escapeHtml(projectName)}</strong> project.`,
                            }

                            if(historyObj && Object.keys(historyObj).length) {
                                HandleHistory('task', companyId, projectId, taskId, historyObj, userData)
                                .catch((error) => {
                                    logger.error(`ERROR in history: ${error.message}`);
                                });
                                HandleHistory('project', companyId, projectId, null, historyObj, userData)
                                .catch((error) => {
                                    logger.error(`ERROR in history: ${error.message}`);
                                });
                            }
                            if(!quiet && notificationObject && Object.keys(notificationObject).length) {
                                HandleBothNotification({type: 'tasks', companyId, projectId, taskId, folderId: before.folderObjId || '', sprintId: before.sprintId || '',  object: notificationObject, userData})
                                .catch((error) => {
                                    logger.error(`ERROR in add notification: ${error.message}`);
                                })
                            }
                        } catch(error) {
                            logger.error(`ERROR: ${error.message}`);
                        }
                    })
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

    /* The task goes under `taskId` with its subtree intact: every row takes the chain its new place
     * gives and the placement of the new root. Refused, before anything is written, when the result
     * would pass three levels or put the task under itself. */
    async convertToSubTask({companyId, projectData, sprintId,selectedTaskId, taskId,oldProject,isSubTask,userData}) {
        const selected = await storedTask(companyId, selectedTaskId);
        if (!selected) throw taskNotFound();
        const descendants = await loadSubtree(companyId, selectedTaskId, { projection: { ancestors: 1 } });
        const slot = await slotUnder(companyId, taskId, { task: selected, descendants });
        if (!slot.ok) throw new TaskWriteRefusal(slot.code === 'PARENT_NOT_FOUND' ? 404 : 400, slot.reason, slot.code);
        const parent = slot.parent;
        const wasSubTask = selected.isParentTask === false;

        await convertToSubTaskFunction(companyId, projectData, sprintId, selected, parent, oldProject, wasSubTask, isSubTask, userData, slot.ancestors);
        await carrySubtree(companyId, selectedTaskId, slot.ancestors, {
            projectData: { ...projectData, id: String(slot.placement.ProjectID) },
            sprintObj: slot.placement.sprintArray,
            oldProject,
            userData,
        });
        return {status: true, statusText: "Convert to task successfully",sprintCount: 1 + descendants.length};
    },

    /* `rowOnly` and `carried` are set by bulkMove alone, which lists the task's subtree itself so
     * every row keeps its own assignees and names the rows that only follow; the task routes drop
     * both from a body. A row that follows keeps the state it holds. */
    moveTask({companyId, projectData, sprintObj,moveTaskId ,oldSprintObj,oldProject,isSubTask,assignee,watcher,userData,rowOnly = false,carried = false}) {
        try {
            return new Promise((resolve, reject) => {
                let moveTaskArray = [];
                let object = {
                    type: dbCollections.TASKS,
                    data: [
                        {
                            _id : new mongoose.Types.ObjectId(moveTaskId)
                        }
                    ]
                }
                MongoDbCrudOpration(companyId,object, "findOne").then(async(move) => {
                    if (!move) {
                        reject(taskNotFound());
                        return;
                    }
                    if (!rowOnly && move.ParentTaskId) {
                        reject(new TaskWriteRefusal(400, 'A subtask moves with its parent.', 'SUBTASK_MOVES_WITH_PARENT'));
                        return;
                    }
                    moveTaskArray.push(move);
                    if (!rowOnly) {
                        moveTaskArray = moveTaskArray.concat(await loadSubtree(companyId, moveTaskId, { filter: { deletedStatusKey: { $nin: [1] } } }));
                    }
                    let promisesArr = [];
                    moveTaskArray.forEach((moveTask, at) => {
                        promisesArr.push(
                            new Promise(async(resolve1, reject1) => {
                                try {
                                    moveTaskFunction(companyId, projectData, sprintObj, moveTask,oldSprintObj,oldProject,assignee,watcher,userData,isSubTask,carried || at > 0).then(() => {
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
                }).catch(reject);
            })
        } catch (error) {
            logger.error(`${error} Error in move task.`)
            return Promise.reject(error);
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
                    if (!task) {
                        reject(taskNotFound());
                        return;
                    }

                    let updateObj = {
                        type: schema,
                        data: [
                            { _id: new mongoose.Types.ObjectId(taskId) },
                            { $set: { deletedStatusKey: 1 } },
                            { returnDocument: 'after' }
                        ]
                    }

                    MongoDbCrudOpration(companyId, updateObj, "findOneAndUpdate").then((result)=>{
                        socketEmitter.emit('update', { type: "update", data: result , updatedFields: { deletedStatusKey: 1 }, module: 'task', companyId });
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
                        resolve({status: true, statusText: "List added successfully", data: res.data});

                        const decObj = {
                            body: {
                                companyId: companyId,
                                projectId: projectData.id,
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
                                    { returnDocument: 'after' }
                                ]
                            }
                            MongoDbCrudOpration(companyId, updateObj1, "findOneAndUpdate").then((result)=>{
                                if (!result) return;
                                socketEmitter.emit('update', { type: "update", data: result , updatedFields: {subTasks: result.subTasks}, module: 'task', companyId });
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
                        MongoDbCrudOpration(companyId, delObj, "deleteOne")
                            .then(() => removeLinksOfTasks(companyId, [task._id]))
                            .catch((error) => logger.error(`convert to list, removing the task: ${error && error.message}`));
                        keptAiValues.forgetTask(companyId, task._id).catch((error) => logger.error(`kept AI values of converted task ${task._id}: ${error.message}`));

                        /* Its subtasks become tasks of the new list whatever the request says, or they
                         * would be left under a task that no longer exists; theirs stay under them. */
                        const newList = res.data;
                        if (!newList) return;
                        const element ={ id: newList._id, name: newList.name, value: String(newList.name || '').replace(/\s/g, "_").toUpperCase() };
                        if (newList.folderId) Object.assign(element, { folderId: newList.folderId, folderName: newList.folderName });
                        MongoDbCrudOpration(companyId, { type: schema, data: [{ ParentTaskId: String(task._id), deletedStatusKey: { $nin: [1] } }] }, "find").then((result) => {
                            return Promise.allSettled(result.map((subTask) => convertToListSubTask(companyId, projectData, subTask, newList, sprintObj)
                                .then(() => carrySubtree(companyId, subTask._id, [], { projectData, sprintObj: element, oldProject: { id: projectData.id }, userData }))
                                .catch((error) => {
                                    logger.error(`ERROR IN CONVERT TO LIST FUNCTION ${error}`)
                                })));
                        }).catch((error) => {
                            logger.error(`ERROR IN CONVERT TO LIST SUBTASKS ${error}`)
                        });
                    })
                }).catch(reject);
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
                    socketEmitter.emit('update', { type: "update", data: result , updatedFields: {deletedStatusKey : 1}, module: 'task', companyId });
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
                                ancestors: [],
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
                                ancestors: [],
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
                                    $unset: {...unsetObj, cascadedBy: '', extraLists: ''}
                                },
                                {
                                    returnDocument: 'after'
                                }
                            ]
                        }
                        MongoDbCrudOpration(companyId, queryObj, "findOneAndUpdate").then((result) => {
                            socketEmitter.emit('update', { type: "update", data: result , updatedFields: {...obj,folderId: ''}, module: 'task', companyId });
                            let object = {
                                type:SCHEMA_TYPE.TASKS,
                                data: [
                                    { _id: new mongoose.Types.ObjectId(task.ParentTaskId || parentTaskId) },
                                    {$inc: {"subTasks": -1}},
                                    {returnDocument: 'after'}
                                ]
                            }
                            MongoDbCrudOpration(companyId, object, "findOneAndUpdate").then(async (response) => {
                                socketEmitter.emit('update', { type: "update", data: response , updatedFields: {subTasks: response.subTask}, module: 'task', companyId });
                                await carrySubtree(companyId, taskId, [], { projectData, sprintObj, oldProject }).catch((error) => {
                                    logger.error(`ERROR IN CONVERT TO TASK SUBTREE ${error}`)
                                });
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

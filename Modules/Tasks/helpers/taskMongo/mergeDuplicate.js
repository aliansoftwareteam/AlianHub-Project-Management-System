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
    },
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
};

const { dbCollections } = require('../../../../Config/collections')
const { sanitizeInput } = require("../../../serviceFunction");
const { HandleHistory,HandleTask,convertToSubTaskFunction, moveTaskFunction, convertToListSubTask,mergeSubTask, duplicateSubTaskFunction, addHistoryCollection, removeCommentCount,updateHistoryCollection, updateTimesheetCollection, updateEstimatedTimeCollection, carrySubtree} = require("../mongo_helper")
const { ancestorsOf, loadSubtree, slotUnder } = require('../taskTree');

const { createTask, taskAssigneeAdd, taskAssigneeRemove,taskAssigneeReplace, taskNameEdit, taskPriorityChange, taskStatusChange, taskAttachmentAdd, taskAttachmentRemove, taskTypeChage, taskTotalEstimate } = require('../notificationTemplate')
const { HandleBothNotification } = require("../handleNotification")
const logger = require("../../../../Config/loggerConfig")
const { addSprintFun, updateSprintFun } = require("../../../Sprints/controller")
const { SCHEMA_TYPE } = require('../../../../Config/schemaType');
const { MongoDbCrudOpration } = require("../../../../utils/mongo-handler/mongoQueries");
const { default: mongoose } = require("mongoose")
const { updateUnReadCommentsCountFun } = require("../../../notification-count/controller")
const { handleTaskAttachmentsDuplicateFunctionality } = require(`../../../../common-storage/common-${process.env.STORAGE_TYPE}.js`)
const { isTaskStoredFile, taskAttachmentKey } = require('../../../../common-storage/taskFileKeys');
const { copyFieldFiles } = require('../../../CustomField/helpers/fieldFiles');
const { copyFieldLinks } = require('../../../CustomField/helpers/fieldLinks');
const { cleanDescription, DESCRIPTION_FIELDS } = require('../cleanRichText');
const { buildQueryObject, buildHistoryObject, convertToDisplayFormat } = require("../helper");
const socketEmitter = require('../../../../event/socketEventEmitter');
const { addCommentCollection, updateCommentCollection } = require('../../../Comments/controller')
const { updateMainChat } = require('../../../MainChats/controller');
const { replaceObjectKey } = require("../../../Auth/helper");
const { emitListener } = require("../../../Company/eventController.js");
const { createCustomFields } = require("../helper.js");
const { removeCache } = require('../../../../utils/commonFunctions.js');
const { updateRemainingTime } = require('../../../LogTime/controllerV2.js');

/* The download check judges a task attachment by the task its folder names, and the merged task is
 * soft-deleted, so its files are copied into the kept task's folder. Only the merged task's own folder
 * qualifies: the server copy takes the whole folder, and a sprint or form folder holds other tasks' files.
 * A failed copy keeps the old key, still judged by the merged task. */
const rehomeMergedAttachments = (companyId, source, kept) => Promise.all((source.attachments || []).map(async (attachment) => {
    const url = attachment && attachment.url;
    const own = taskAttachmentKey(url);
    if (!own || own.taskId !== String(source._id).toLowerCase()) return attachment;
    const rehomed = `Project/${kept.ProjectID}/Sprint/${kept._id}/Attachment/${url.slice(url.lastIndexOf('/') + 1)}`;
    try {
        await handleTaskAttachmentsDuplicateFunctionality(companyId, url, rehomed);
        return { ...attachment, url: rehomed };
    } catch (error) {
        logger.error(`merge could not copy an attachment to the kept task: ${error.message || error}`);
        return attachment;
    }
}));

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
                    .then(async (mergeTask) => {
                        const movedAttachments = await rehomeMergedAttachments(companyId, task, mergeTask);
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
                            socketEmitter.emit('update', { type: "update", data: result , updatedFields: {deletedStatusKey: result.deletedStatusKey}, module: 'task', companyId });
                        })

                        let finalAttach = mergeTask.attachments ? mergeTask.attachments : [];
                        finalAttach = finalAttach.concat(movedAttachments);
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
                        try {
                            cleanDescription(mergeObj);
                        } catch (error) {
                            // The other task is already in the trash by now: the kept task keeps its own description.
                            DESCRIPTION_FIELDS.forEach((field) => { delete mergeObj[field]; });
                            logger.error(`merge left the description as it was: ${error.message}`);
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
                            socketEmitter.emit('update', { type: "update", data: result , updatedFields: mergeObj, module: 'task', companyId });
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
                                socketEmitter.emit('update', { type: "update", data: result , updatedFields: {subTasks: result.subTasks}, module: 'task', companyId });
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
                        /* The merged task's subtasks go under the kept task, each with its own subtree
                         * intact, or under the nearest task above it that can take them within three
                         * levels. They are re-homed whatever the request says: left behind, they would
                         * sit under a deleted task. */
                        const subTaskArray = await MongoDbCrudOpration(companyId, {
                            type: SCHEMA_TYPE.TASKS,
                            data: [{ ParentTaskId: String(task._id), deletedStatusKey: { $nin: [1] } }],
                        }, 'find').catch(() => []);
                        if(subTaskArray.length){
                            const above = [...ancestorsOf(mergeTask), String(mergeTask._id)].reverse();
                            const target = { projectData: { ...projectData, id: String(mergeTask.ProjectID) }, sprintObj: mergeTask.sprintArray, oldProject, userData };
                            for (const stask of subTaskArray) {
                                try {
                                    const moving = { task: stask, descendants: await loadSubtree(companyId, stask._id, { projection: { ancestors: 1 } }) };
                                    let slot = null;
                                    for (const parentId of above) {
                                        slot = await slotUnder(companyId, parentId, moving);
                                        if (slot.ok) break;
                                    }
                                    if (!slot || !slot.ok) throw new Error((slot && slot.reason) || 'no parent');
                                    await mergeSubTask(companyId, stask, mergeTask, projectData, oldProject, slot);
                                    await carrySubtree(companyId, stask._id, slot.ancestors, target);
                                } catch (error) {
                                    logger.error(`ERROR IN MERGE SUBTASK ${error}`)
                                }
                            }
                            resolve({status: true, statusText: "merge Task successfully",sprintCount: subTaskArray.length + 1});
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
                    delete obj.cascadedBy;
                    obj.ancestors = [];
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
                        socketEmitter.emit('update', { type: "update", data: response , updatedFields: {taskTypeCounts: response.taskTypeCounts,lastTaskId: response.lastTaskId}, module: 'task', companyId });
                        obj.TaskKey = projectData.ProjectCode + '-' +  response.lastTaskId;
                        HandleTask(companyId, obj, false, null, userData,indexObj)
                        .then((taskResult) => {
                            if(taskResult.status){
                                resolve({status: true, statusText: "Duplicate Task Added",taskId :taskResult.id });
                                /* Filled as each subtask is copied, so a link between two copied tasks is carried to their copies. */
                                const copied = new Map([[String(selectedTask._id), String(taskResult.id)]]);
                                const copyLinks = () => copyFieldLinks({ companyId, actorId: userData && userData.id, pairs: copied })
                                    .catch((error) => logger.error(`field links copy on duplicate: ${error && error.message}`));
                                if(duplicateData.includes('Attachments')){
                                    copyFieldFiles({ companyId, source: selectedTask, target: { _id: taskResult.id, ProjectID: projectData.id } })
                                        .catch((error) => logger.error(`field files copy on duplicate: ${error && error.message}`));
                                    if(selectedTask.attachments.length > 0) {
                                        /* Only a file stored for the source task is copied; any other key stays as it was, read under its own owner. */
                                        const promises = selectedTask.attachments.map(async (x) => {
                                            const previousUrl = x.url;
                                            if (!(await isTaskStoredFile(companyId, selectedTask, previousUrl))) return;
                                            let lastSlashIndex = previousUrl.lastIndexOf('/');
                                            let fileName = previousUrl.substring(lastSlashIndex + 1);
                                            x.url = `Project/${projectData.id}/Sprint/${taskResult.id}/Attachment/${fileName}`;
                                            await handleTaskAttachmentsDuplicateFunctionality(companyId, previousUrl, x.url);
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
                                                socketEmitter.emit('update', { type: "update", data: result , updatedFields: {attachments: result.attachments}, module: 'task', companyId });
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
                                        addCommentCollection(companyId, projectData,selectedTask,taskResult,sprintObj,userData)
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
                                            ParentTaskId: String(selectedTask._id),
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
                                                    copyLinks();
                                                    resolve({status: true, statusText: "subtask merged successfully"});
                                                    return;
                                                }else{
                                                    let promise = [];
                                                    row.forEach((stask)=>{
                                                        promise.push(duplicateSubTaskFunction(companyId, projectData, sprintObj, stask, taskResult.id,userData, oldProject,duplicateData, undefined, copied));
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
                                } else {
                                    copyLinks();
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

const moment = require('moment');
const logger = require("../../../Config/loggerConfig");
const { DateTime } = require('luxon');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { default: mongoose } = require('mongoose');
const { updateSprintCount } = require('../../notification-count/controller');
const { updateSprintFun } = require('../../Sprints/controller');
const { dbCollections } = require('../../../Config/collections');
const { handleTaskAttachmentsDuplicateFunctionality } = require(`../../../common-storage/common-${process.env.STORAGE_TYPE}.js`);
const { getCachedCompanyData } = require('../../../utils/planHelper');
const serviceFun = require("../../serviceFunction");
const socketEmitter = require('../../../event/socketEventEmitter');
const { updateCommentCollection, addCommentCollection } = require('../../Comments/controller');

/* ------------- TASK ------------- */
exports.HandleTask = async (companyId, object, isUpdate, id = null, userData) => {
    return new Promise(async (resolve, reject) => {
        try {
            const hasPermission = await exports.getTotalSprintCount(companyId, object.sprintId);
            if(hasPermission){
                // Check if is update
                if (isUpdate && id === null) {
                    reject("Id field should not be empty or undefined.");
                    return;
                }
    
                // Required keys for validation
                let keys = ["TaskName", "TaskKey", "TaskType", "ProjectID", "CompanyId"];
                let valid = "";
    
                object = JSON.parse(JSON.stringify(object));
    
                keys.forEach(key => {
                    if (typeof object[key] !== "object" && (object[key] === undefined || !object[key].length)) {
                        valid += key + ", ";
                    } else if (typeof object[key] === "object" && object[key] !== undefined && Object.keys(object[key]).length) {
                        valid += key + ", ";
                    }
                })
    
                if (valid.length) {
                    // Is invalid
                    valid += "fields should not be empty or undefined."
                    reject({ message: valid });
                    return;
                }
    
                // MAKE CHANGES FOR DUE DATE & START DATE
                if (object.startDate && object.startDate.length) {
                    object.startDate = new Date(object.startDate);
                }
                if (object.DueDate && object.DueDate.length) {
                    object.dueDateDeadLine = object.dueDateDeadLine.map((x) => new Date(x.date));
                    object.DueDate = new Date(object.DueDate);
                }
    
                let data;
                if (isUpdate || id !== null) {
                    data = [{
                        _id: id
                    }, {...object}]
                } else {
                    data = {...object};

                    if(data._id) {
                        data._id = new mongoose.Types.ObjectId(data._id);
                    }
                }
    
                data.CompanyId = new mongoose.Types.ObjectId(data.CompanyId);
                data.ProjectID = new mongoose.Types.ObjectId(data.ProjectID);
                let objSchema = {
                    type: SCHEMA_TYPE.TASKS,
                    data: data
                }

                const sanitizedNewTaskName = serviceFun.sanitizeInput(object.TaskName);
                MongoDbCrudOpration(companyId, objSchema, isUpdate ? 'updateOne' : 'save')
                    .then(async (response) => {
                        socketEmitter.emit('insert', { type: "insert", data: response , module: 'task'});
                        const historyObj = {
                            message: `<b>${userData.Employee_Name}</b> has created new <b>${sanitizedNewTaskName}</b> ${object.TaskType.replace(/_/g, '-')}.`,
                            key: "Task_Created",
                            sprintId: object.sprintId,
                            mainChat: object?.mainChat || false
                        }
                        // BUG-016 / #70 fix: previously this block called
                        // `resolve(...)` first and then chained two
                        // `HandleHistory(...).catch(reject)` calls. Calling
                        // `reject` on an already-settled Promise is a no-op,
                        // so history failures were silently swallowed. Await
                        // both history calls via `Promise.allSettled` (so a
                        // failure on one doesn't block the other) and log
                        // any failures before resolving.
                        await Promise.allSettled([
                            exports.HandleHistory('task', companyId, object.ProjectID, isUpdate ? id : response._id, historyObj, userData)
                                .catch((error) => {
                                    logger.error(`HandleTask task-history error: ${error && error.message ? error.message : error}`);
                                }),
                            exports.HandleHistory('project', companyId, object.ProjectID, null, historyObj, userData)
                                .catch((error) => {
                                    logger.error(`HandleTask project-history error: ${error && error.message ? error.message : error}`);
                                }),
                        ]);
                        resolve({ status: true, id: isUpdate ? id : response._id, message: "Task created successfully." });
                    }).catch(error => {
                        reject(error);
                    })
            }
            else{
                resolve({ status: false,isUpgrade: true, message: "Upgrade your plan" });
            }
        } catch (error) {
            reject(error);
        }
    })
}

/* ------------- HANDLE HISTIRY FOR ALL THE ACTIVITIES ------------- */
exports.HandleHistory = (type, companyId, projectId, taskId, object, userData) => {
    return new Promise(async (resolve, reject) => {
        try {
            const obj = {
                'Type': type,
                'Key': object.key,
                'UserId': userData.id,
                'ProjectId': projectId,
                'TaskId': taskId !== null ? taskId : "",
                'Message': object.message
            }
            if (type == "Logtask") {
                obj.Type = "task";
            }
            const utcDateTime = DateTime.utc();
            const data = {
                'Type': type,
                'Key': object.key,
                'UserId': userData.id,
                'ProjectId': projectId,
                'TaskId': taskId !== null ? taskId : "",
                'Message': object.message,
                createdAt:utcDateTime.ts,
                updatedAt:utcDateTime.ts,
            }
            let typeSchema = SCHEMA_TYPE.HISTORY
          
            let objSchema = {
                type: typeSchema,
                data: data
            }
            MongoDbCrudOpration(companyId, objSchema, "save")
                .then((response) => {
                    resolve({ status: true });
                }).catch(error => {
                    logger.error(`History========>Error ${error.message}`);
                    reject({ status: false, error: error });
                })
        } catch (error) {
            reject({ status: false, error: error });
        }
    });
}

/* ------------- HANDLE HISTIRY FOR ALL THE ACTIVITIES ------------- */
exports.changeDateFormat = (date, format) => {
    if (date.seconds) {
        return moment(new Date(date.seconds * 1000)).format(format);
    } else {
        return moment(new Date(date)).format(format);
    }
}

exports.convertToSubTaskFunction = (companyId, projectData, sprintId, convertTask, task, oldProject, isMainSubTask,isSubTask,userData) => {
    return new Promise((resolve, reject) => {
        try {
            let deleteObj = {
                type: SCHEMA_TYPE.TASKS,
                data: [
                    {
                        _id: new mongoose.Types.ObjectId(convertTask._id)
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
                let obj = {
                    isParentTask: false,
                    ParentTaskId: task._id,
                    subTasks: 0,
                    deletedStatusKey : 0
                };
                let unsetObj = {}
                if (convertTask.sprintId !== task.sprintId && JSON.parse(JSON.stringify(convertTask)).ProjectID === JSON.parse(JSON.stringify(task)).ProjectID) {
                    obj = {
                        ...obj,
                        sprintId: task.sprintId,
                        sprintArray: task.sprintArray,
                    }
                    if(task.folderObjId){
                        obj.folderObjId = task.folderObjId;
                    }else{
                        if(convertTask.folderObjId){
                            unsetObj = {
                                folderObjId:''
                            }
                            delete convertTask.folderObjId;
                        }
                    }
                }
                else if (JSON.parse(JSON.stringify(convertTask)).ProjectID !== JSON.parse(JSON.stringify(task)).ProjectID) {
                    let Ind = oldProject.taskStatusData.findIndex((x) => { return x.key === convertTask.statusKey });
                    let typeInd = oldProject.taskTypeCounts.findIndex((x) => { return x.value === convertTask.TaskType });
                    statusData = oldProject.taskStatusData[Ind];
                    typeData = oldProject.taskTypeCounts[typeInd];
                    obj = {
                        ...obj,
                        ProjectID: task.ProjectID,
                        sprintId: task.sprintId,
                        sprintArray: task.sprintArray,
                        status: {
                            key: statusData.convertStatus.key,
                            value: '',
                            text: statusData.convertStatus.name,
                            type: statusData.convertStatus.type
                        },
                        statusType: statusData.convertStatus.type,
                        statusKey: statusData.convertStatus.key,
                        TaskType: typeData.convertType.value,
                        TaskTypeKey: typeData.convertType.key
                    }
                    if(task.folderObjId){
                        obj.folderObjId = task.folderObjId;
                    }else{
                        if(convertTask.folderObjId){
                            unsetObj = {
                                folderObjId:''
                            }
                            delete convertTask.folderObjId;
                        }
                    }
                } else {
                    obj = {
                        ...obj,
                    }
                }
                let queryObj = {
                    type: SCHEMA_TYPE.TASKS,
                    data: [
                        {
                            _id: new mongoose.Types.ObjectId(convertTask._id)
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
                    socketEmitter.emit('update', { type: "update", data: result , updatedFields: obj, module: 'task' });
                    /*When a subtask is converted to another subtask within a parent task, and a subtask is removed, the count of the parent task is reduced.*/
                    if (isMainSubTask === true) {
                        let object = {
                            type:SCHEMA_TYPE.TASKS,
                            data: [
                                { _id: new mongoose.Types.ObjectId(convertTask.ParentTaskId) },
                                {$inc: {"subTasks": -1}}
                            ]
                        }
                        MongoDbCrudOpration(companyId, object, "updateOne").then((mainRes)=>{
                            socketEmitter.emit('update', { type: "update", data: mainRes , updatedFields: {subTasks: mainRes.subTasks}, module: 'task' });
                        })
                    }
                    /*When a task is converted into  asubtask, at that moment, if a subtask is added to the selected task, the count needs to be increased.*/
                    let object = {
                        type:SCHEMA_TYPE.TASKS,
                        data: [
                            { _id: new mongoose.Types.ObjectId(task._id) },
                            {$inc: {"subTasks": 1}},
                            {returnDocument: 'after'}
                        ]
                    }
                    MongoDbCrudOpration(companyId, object, "findOneAndUpdate").then((taskres)=>{
                        socketEmitter.emit('update', { type: "update", data: taskres , updatedFields: {subTasks: taskres.subTasks}, module: 'task' });
                    })
                    // update comment count
                    exports.removeCommentCount(companyId,projectData.id,convertTask.sprintId,convertTask._id,convertTask.ParentTaskId).catch((error) => {
                        logger.error(`${error} ERROR IN REMOVE COMMENT COUNT`);
                    })
                    resolve({ status: true, statusText: "Converted in to subtask successfully"});
                    if(convertTask.isParentTask === true){
                        const historyObj = {
                            key: "Task_Convert_To_SubTask",
                            sprintId: sprintId,
                            mainChat: false
                        }
                        if(convertTask.sprintId === task.sprintId){
                            historyObj.message = `<b>${userData.Employee_Name}</b> has converted the <b>${serviceFun.sanitizeInput(convertTask.TaskName)}</b> task to subtask of <b>${serviceFun.sanitizeInput(task.TaskName)}</b> task ${isSubTask === true ? '<b>with all its sub tasks</b>' : ''}.`
                        }else if(convertTask.sprintId !== task.sprintId && JSON.parse(JSON.stringify(convertTask))?.ProjectID === JSON.parse(JSON.stringify(task))?.ProjectID){
                            historyObj.message = `<b>${userData.Employee_Name}</b> has converted the <b>${serviceFun.sanitizeInput(convertTask.TaskName)}</b> task of <b>(${convertTask.folderObjId ?  convertTask.sprintArray.folderName + '/' : ''}${convertTask.sprintArray.name})</b> sprint to subtask of <b>${serviceFun.sanitizeInput(task.TaskName)}</b> task <b>(${task.folderObjId ? task.sprintArray.folderName + '/'  : ''}${task.sprintArray.name})</b>${isSubTask === true ? '<b>with all its sub tasks</b>' : ''}.`
                        }else{
                            historyObj.message = `<b>${userData.Employee_Name}</b> has converted the <b>${serviceFun.sanitizeInput(convertTask.TaskName)}</b> task of <b>(${oldProject.ProjectName}${convertTask.folderObjId ? '/' + convertTask.sprintArray.folderName : ''}/${convertTask.sprintArray.name})</b> sprint to subtask of <b>${serviceFun.sanitizeInput(task.TaskName)}</b> task <b>(${projectData.ProjectName}${task.folderObjId ? '/' + task.sprintArray.folderName : ''}/${task.sprintArray.name})</b> ${isSubTask === true ? '<b>with all its sub tasks</b>' : ''}.`
                        }
                        exports.HandleHistory('task', companyId, projectData.id, convertTask._id, historyObj, userData);
                    }
                    if(convertTask.sprintId !== task.sprintId || JSON.parse(JSON.stringify(convertTask)).ProjectID !== JSON.parse(JSON.stringify(task)).ProjectID){
                        const incObj = {
                            body: {
                                companyId: companyId,
                                projectId: task.ProjectID,
                                updateObject: {$inc: {tasks: 1}},
                                folderId: task?.folderObjId,
                            },
                            params : {
                                id: task.sprintId
                            }
                        }
                        updateSprintFun(incObj).catch((error) => {
                            logger.error(`error in update task count : ${error}`)
                        });
                        const decObj = {
                            body: {
                                companyId: companyId,
                                projectId: convertTask.ProjectID,
                                updateObject: {$inc: {tasks: -1}},
                                folderId: convertTask?.folderObjId || null,
                            },
                            params : {
                                id: convertTask.sprintId
                            }
                        }
                        updateSprintFun(decObj).catch((error) => {
                            logger.error(`error in update task count : ${error}`)
                        });
                    }
                }).catch((error) => {
                    // BUG-016 / #70 fix: this `.catch` is chained to the
                    // inner `MongoDbCrudOpration().then(...)`. By the time
                    // this fires, the outer Promise may already have been
                    // resolved by the inner `resolve({status:true, ...})`,
                    // so `reject(error)` would be a no-op. Log instead so
                    // the failure is visible.
                    logger.error(`convertToSubTaskFunction inner update error: ${error && error.message ? error.message : error}`);
                })
            })
        } catch (error) {
            reject(error);
        }
    })
}

exports.moveTaskFunction = (companyId, projectData, sprintObj, moveTask, oldSprintObj, oldProject,assignee,watcher,userData,isSubTask) => {
    return new Promise((resolve, reject) => {
        try {
            let deleteObj = {
                type: SCHEMA_TYPE.TASKS,
                data: [
                    {
                        _id: new mongoose.Types.ObjectId(moveTask._id)
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
                let obj = {};
                let unsetObj = {}
                if (JSON.parse(JSON.stringify(moveTask.ProjectID)) !== JSON.parse(JSON.stringify(projectData.id))) {
                    let Ind = oldProject.taskStatusData.findIndex((x) => { return x.key === moveTask.statusKey });
                    let typeInd = oldProject.taskTypeCounts.findIndex((x) => { return x.value === moveTask.TaskType });
                    statusData = oldProject.taskStatusData[Ind];
                    typeData = oldProject.taskTypeCounts[typeInd];
                    obj = {
                        ProjectID: projectData.id,
                        sprintId: sprintObj.id,
                        sprintArray: sprintObj,
                        status: {
                            key: statusData.convertStatus.key,
                            value: '',
                            text: statusData.convertStatus.name,
                            type: statusData.convertStatus.type
                        },
                        statusType: statusData.convertStatus.type,
                        statusKey: statusData.convertStatus.key,
                        TaskType: typeData.convertType.value,
                        TaskTypeKey: typeData.convertType.key,
                        deletedStatusKey : 0,
                    }
                    if(sprintObj.folderId){
                        obj.folderObjId = sprintObj.folderId;
                    }else{
                        if(moveTask.folderObjId){
                            delete moveTask.folderObjId;
                            unsetObj = {
                                folderObjId:''
                            }
                        }
                    }
                }
                else {
                    obj = {
                        ProjectID: new mongoose.Types.ObjectId(moveTask.ProjectID),
                        sprintId: new mongoose.Types.ObjectId(sprintObj.id),
                        sprintArray: sprintObj,
                        deletedStatusKey: 0,
                    }
                    if(sprintObj.folderId){
                        obj.folderObjId = sprintObj.folderId;
                    }else{
                        if(moveTask.folderObjId){
                            unsetObj = {
                                folderObjId:''
                            }
                            delete moveTask.folderObjId;
                        }
                    }
                }
                obj.AssigneeUserId = assignee || [];
                obj.watchers = watcher || [];
                let queryObj = {
                    type: SCHEMA_TYPE.TASKS,
                    data: [
                        {
                            _id: new mongoose.Types.ObjectId(moveTask._id)
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
                const historyObj = {
                    key: "Task_Moved",
                    sprintId: sprintObj.id,
                    mainChat: false
                }
                if(JSON.parse(JSON.stringify(moveTask))?.ProjectID !== projectData.id){
                    historyObj.message = `<b>${userData.Employee_Name}</b> has moved <b>${moveTask.TaskName}</b> task from <b>(${oldProject.ProjectName}${oldSprintObj.folderId ? '/' + oldSprintObj.folderName : ''}/${oldSprintObj.name})</b> to <b>(${projectData.ProjectName}${sprintObj.folderId ? '/' + sprintObj.folderName : ''}/${sprintObj.name})</b> project ${isSubTask === true ? '<b>with all its sub tasks</b>' : ''}.`
                }else{
                    historyObj.message = `<b>${userData.Employee_Name}</b> has moved <b>${moveTask.TaskName}</b> task from <b>(${oldSprintObj.folderId ?  oldSprintObj.folderName + '/' : ''}${oldSprintObj.name})</b> to <b>(${sprintObj.folderId ? sprintObj.folderName + '/'  : ''}${sprintObj.name})</b> sprint ${isSubTask === true ? '<b>with all its sub tasks</b>' : ''}.`
                }
                exports.HandleHistory('task', companyId, projectData.id, moveTask._id, historyObj, userData);
                MongoDbCrudOpration(companyId, queryObj, "findOneAndUpdate").then((ele) => {
                    socketEmitter.emit('update', { type: "update", data: ele , updatedFields: obj, module: 'task' });
                    resolve({ status: true, statusText: "MOVE" });

                    updateCommentCollection(companyId, moveTask,sprintObj,projectData,moveTask._id).catch((err) => { logger.error(`${err},ERROR IN ADD COMMENTS IN SUBTASK`); })
                    if(moveTask.ProjectID !== projectData.id){
                        exports.updateHistoryCollection(companyId, moveTask,projectData,moveTask._id).catch((err) => { logger.error(`${err},ERROR IN ADD HISTORY COLLECTION IN SUBTASK`);});
                        exports.updateTimesheetCollection(companyId, moveTask,projectData,moveTask._id).catch((err) => { logger.error(`${err},ERROR IN ADD TIMESHEET COLLECTION IN SUBTASK`);});
                        exports.updateEstimatedTimeCollection(companyId, moveTask,projectData,moveTask._id).catch((err) => { logger.error(`${err},ERROR IN ADD ESTIMATED TIME COLLECTION IN SUBTASK`);});
                    }
                    exports.removeCommentCount(companyId,oldProject.id,oldSprintObj.id,moveTask._id,moveTask.ParentTaskId).catch((error) => {
                        logger.error(`${error} ERROR IN REMOVE COMMENT COUNT`);
                    })
                    const incObj = {
                        body: {
                            companyId: companyId,
                            projectId: projectData.id,
                            updateObject :{$inc: { tasks: 1}},
                            folderId: sprintObj?.folderId || null,
                        },
                        params : {
                            id : sprintObj.id
                        }
                    }
                    updateSprintFun(incObj).catch((error) => {
                        logger.error(`error in update task count : ${error}`)
                    });
                    const decObj = {
                        body: {
                            companyId: companyId,
                            projectId: oldProject.id,
                            updateObject :{$inc: { tasks: -1}},
                            folderId: oldSprintObj?.folderId || null,
                        },
                        params : {
                            id : oldSprintObj.id
                        }
                    }
                    updateSprintFun(decObj).catch((error) => {
                        logger.error(`error in update task count : ${error}`)
                    });
                }).catch((error)=>{
                    logger.error(`${error} ERROR IN MONGO QUERY`);
                })
            })
        } catch (error) {
            reject(error);
        }
    })
}

exports.convertToListSubTask = (companyId, projectData, subTask, sprintObj, oldSprintObj) => {
    return new Promise((resolve, reject) => {
        try {
            let sprintObjData = sprintObj;
            let sprintId = sprintObjData._id
            let sprintName = sprintObjData.name;
            let parseSubTask = JSON.parse(JSON.stringify(subTask))
            let obj = {
                ...parseSubTask,
                sprintId: sprintId,
                sprintArray: {
                    id: sprintId,
                    name: sprintName,
                    value: sprintName.replace(/\s/g, "_").toUpperCase(),
                },
                ParentTaskId: '',
                isParentTask: true,
            }
            let unsetObj = {};
            if (sprintObjData.folderId !== undefined && sprintObjData?.folderId) {
                obj.sprintArray.folderId = sprintObjData.folderId,
                obj.sprintArray.folderName = sprintObjData.folderName
                obj.folderObjId = sprintObjData.folderId
            }else{
                if(parseSubTask.folderObjId){
                    unsetObj = {
                        folderObjId:''
                    }
                    delete parseSubTask.folderObjId;
                }
            }

            const schema = SCHEMA_TYPE.TASKS
            const query = {
                type: schema,
                data: [
                    { _id: new mongoose.Types.ObjectId(parseSubTask._id) },
                    { 
                        $set: { ...obj } ,
                        $unset: unsetObj
                    },
                ]
            }
            MongoDbCrudOpration(companyId, query, "updateOne").then(() => {
                exports.removeCommentCount(companyId,projectData,oldSprintObj.id,parseSubTask._id).catch((error) => {
                    logger.error(`${error} ERROR IN REMOVE COMMENT COUNT`);
                })
                resolve();
                const decObj = {
                    body: {
                        companyId: companyId,
                        projectId: projectData.id,
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
                        id : sprintId
                    }
                }
                updateSprintFun(incObj).catch((error) => {
                    logger.error(`error in update task count : ${error}`)
                });
            }).catch((error) => {
                console.log(error,"ERROR")
            });
        } catch (error) {
            reject(error);
        }
    })
}

exports.mergeSubTask = (companyId, subTask, mergeTask, projectData, oldProject) => {
    return new Promise((resolve, reject) => {
        try {
            let obj;
            if (subTask.ProjectID !== mergeTask.ProjectID) {
                let Ind = oldProject.taskStatusData.findIndex((x) => { return x.key === subTask.statusKey });
                let typeInd = oldProject.taskTypeCounts.findIndex((x) => { return x.value === subTask.TaskType });
                statusData = oldProject.taskStatusData[Ind];
                typeData = oldProject.taskTypeCounts[typeInd];
                obj = {
                    sprintId: mergeTask.sprintId,
                    sprintArray: {
                        id: mergeTask.sprintId,
                        name: mergeTask.sprintArray.name,
                        value: mergeTask.sprintArray.value,
                    },
                    ParentTaskId: mergeTask.isParentTask === true ? mergeTask._id : mergeTask.ParentTaskId,
                    ProjectID: mergeTask.ProjectID,
                    status: {
                        key: statusData.convertStatus.key,
                        value: '',
                        text: statusData.convertStatus.name,
                        type: statusData.convertStatus.type
                    },
                    statusType: statusData.convertStatus.type,
                    statusKey: statusData.convertStatus.key,
                    TaskType: typeData.convertType.value,
                    TaskTypeKey: typeData.convertType.key,
                }
            } else {
                obj = {
                    sprintId: mergeTask.sprintId,
                    sprintArray: {
                        id: mergeTask.sprintId,
                        name: mergeTask.sprintArray.name,
                        value: mergeTask.sprintArray.value,
                    },
                    ParentTaskId: mergeTask.isParentTask === true ? mergeTask._id : mergeTask.ParentTaskId,
                    ProjectID: mergeTask.ProjectID,
                }
            }
            let queryObj = {
                type: SCHEMA_TYPE.TASKS,
                data: [
                    {
                        _id: new mongoose.Types.ObjectId(subTask._id)
                    },
                    {
                        $set: {...obj}
                    },
                    {
                        returnDocument: 'after'
                    }
                ]
            }
            MongoDbCrudOpration(companyId,queryObj,"findOneAndUpdate").then((result) => {
                socketEmitter.emit('update', { type: "update", data: result , updatedFields: obj, module: 'task' });
                resolve({ status: true, statusText: "Sub Task merged Succesfully" });
                let mergeId = mergeTask.isParentTask === true ? mergeTask._id : mergeTask.ParentTaskId;
                let incObj = {
                    type: SCHEMA_TYPE.TASKS,
                    data: [
                        { _id: new mongoose.Types.ObjectId(mergeId) },
                        {$inc: {"subTasks": 1}},
                        {returnDocument: 'after'}
                    ]
                }
                MongoDbCrudOpration(companyId,incObj,"findOneAndUpdate").then((res)=>{
                    socketEmitter.emit('update', { type: "update", data: res , updatedFields: {subTasks: res.subTasks}, module: 'task' });
                }).catch((err) => {
                    logger.error(`ERROR in ${err}`);
                })
                if(subTask.sprintId !== mergeTask.sprintId || JSON.parse(JSON.stringify(subTask)).ProjectID !== JSON.parse(JSON.stringify(mergeTask)).ProjectID){
                    const incCountObj = {
                        body: {
                            companyId: companyId,
                            projectId: mergeTask.ProjectID,
                            folderId: mergeTask?.folderObjId || null,
                            updateObject :{$inc: { tasks: 1}},
                        },
                        params : {
                            id : mergeTask.sprintId
                        }
                    }
                    updateSprintFun(incCountObj).catch((error) => {
                        logger.error(`error in update task count : ${error}`)
                    });
                    const decObj = {
                        body: {
                            companyId: companyId,
                            projectId: oldProject.id,
                            folderId: subTask?.folderObjId || null,
                            updateObject :{$inc: { tasks: -1}},
                        },
                        params : {
                            id : subTask.sprintId
                        }
                    }
                    updateSprintFun(decObj).catch((error) => {
                        logger.error(`error in update task count : ${error}`)
                    });
                }
                exports.removeCommentCount(companyId,projectData.id,subTask.sprintId,subTask._id).catch((error) => {
                    logger.error(`${error} ERROR IN REMOVE COMMENT COUNT`);
                })
            }).catch((err) => {
                logger.error(`ERROR in merge task ${err}`);
            })
        } catch (error) {
            reject(error);
        }
    })
}

exports.duplicateSubTaskFunction = (companyId, projectData, sprintObj, subtask, parentId, userData, oldProject, duplicateData) => {
    return new Promise((resolve, reject) => {
        try {
            let obj = {};
            let parsedMap = JSON.parse(JSON.stringify(subtask))
            if (JSON.parse(JSON.stringify(subtask))?.ProjectID !== projectData.id) {
                let Ind = oldProject.taskStatusData.findIndex((x) => { return x.key === subtask.statusKey });
                let typeInd = oldProject.taskTypeCounts.findIndex((x) => { return x.value === subtask.TaskType });
                let statusData = oldProject.taskStatusData[Ind];
                let typeData = oldProject.taskTypeCounts[typeInd];
                obj = {
                    ...parsedMap,
                    ProjectID: projectData.id,
                    sprintId: sprintObj.id,
                    sprintArray: sprintObj,
                    status: JSON.stringify({
                        key: statusData.convertStatus.key,
                        value: '',
                        text: statusData.convertStatus.name,
                        type: statusData.convertStatus.type
                    }),
                    statusType: statusData.convertStatus.type,
                    statusKey: statusData.convertStatus.key,
                    TaskType: typeData.convertType.value,
                    TaskTypeKey: typeData.convertType.key,
                    AssigneeUserId: [],
                    ParentTaskId: parentId,
                    attachments: duplicateData.includes('Attachments') && subtask.attachments ? subtask.attachments || [] : [],
                    DueDate: duplicateData.includes('Due Date') && subtask.DueDate !== undefined && subtask.DueDate !== null ? new Date(subtask.DueDate) || null : null,
                    dueDateDeadLine: duplicateData.includes('Due Date') && subtask.dueDateDeadLine && subtask.dueDateDeadLine.length ? subtask.dueDateDeadLine.map((x) => ({ date: x && x.date ? new Date(x.date) : '' })) : [],
                    checklistArray: duplicateData.includes('Checklists') && subtask.checklistArray ? subtask.checklistArray : [],
                    startDate: subtask.startDate !== undefined ? new Date(subtask.startDate) || null : null,
                }
            } else {
                obj = {
                    ...parsedMap,
                    ProjectID: subtask.ProjectID,
                    sprintId: sprintObj.id,
                    sprintArray: sprintObj,
                    ParentTaskId: parentId,
                    AssigneeUserId: [],
                    attachments:  [],
                    DueDate: duplicateData.includes('Due Date') && subtask.DueDate !== undefined && subtask.DueDate !== null ? new Date(subtask.DueDate) || null : null,
                    dueDateDeadLine: duplicateData.includes('Due Date') && subtask.dueDateDeadLine && subtask.dueDateDeadLine.length ? subtask.dueDateDeadLine.map((x) => ({ date: x && x.date ? new Date(x.date) : '' })) : [],
                    checklistArray: duplicateData.includes('Checklists') && subtask.checklistArray ? subtask.checklistArray : [],
                    startDate: subtask.startDate !== undefined ? new Date(subtask.startDate) || null : null,
                }
            }
            if(sprintObj.folderId){
                obj.folderObjId = sprintObj.folderId;
            }else{
                delete obj.folderObjId;
            }
            delete obj._id;
            let object = {
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
            MongoDbCrudOpration(companyId, object, "findOneAndUpdate").then((response) => {
                socketEmitter.emit('update', { type: "update", data: response , updatedFields: {taskTypeCounts: response.taskTypeCounts,lastTaskId: response.lastTaskId}, module: 'task' });
                obj.TaskKey = projectData.ProjectCode + '-' +  response.lastTaskId;
                exports.HandleTask(companyId, obj, false, null, userData).then((taskResult) => {
                    if(duplicateData.includes('Attachments')){
                        if(subtask.attachments.length > 0) {
                            let promises = [];

                            subtask.attachments.forEach((x) => {
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
                                            $set: {attachments : subtask.attachments}
                                        },
                                        {
                                            returnDocument: 'after'
                                        }
                                    ]
                                }
                                MongoDbCrudOpration(companyId, updateObj, "findOneAndUpdate").then((ele)=>{
                                    socketEmitter.emit('update', { type: "update", data: ele , updatedFields: {attachments : subtask.attachments}, module: 'task' });
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
                    resolve({ status: true, statusText: "Duplicate Task Added"});
                    try {
                        if (duplicateData.includes('Activity')) {
                            exports.addHistoryCollection(companyId, projectData, subtask, taskResult, sprintObj).catch((err) => { logger.error(`${err},ERROR IN ADD HISTORY IN SUBTASK`); })
                        }
                        if (duplicateData.includes('Comments')) {
                            addCommentCollection(companyId, projectData, subtask, taskResult, sprintObj)
                            .catch((err) => { logger.error(`${err},ERROR IN ADD COMMENTS IN SUBTASK`); })
                        }
                    } catch (error) {
                        reject()
                        logger.error(`${error}ERROR add comment and Activity collection`);
                    }
                }).catch((error) => {
                    logger.error(`${error}ERROR in create task`);
                    reject(error)
                })
            }).catch((err) => {
                reject(err)
            })
        } catch (error) {
            reject(error);
        }
    })
}

exports.addHistoryCollection = (companyId, projectData, task, newTaskData, sprintObj) => {
    return new Promise(async (resolve, reject) => {
        try {
            const history = await MongoDbCrudOpration(companyId, {type: SCHEMA_TYPE.HISTORY,data: [{TaskId : task._id}]}, "find").then((querySnapshot) => {
                if (querySnapshot.length == 0) {
                    return [];
                } else {
                    return querySnapshot;
                }
            })
            let historyToInsert = [];
            history.filter((x) => x.Key !== 'Task_Created').forEach((data) => {
                const obj = {
                    'Type': data.Type,
                    'Key': data.Key,
                    'UserId': data.UserId,
                    'ProjectId': projectData.id,
                    'TaskId': newTaskData.id,
                    'Message': data.Message,
                    createdAt:data.createdAt,
                    updatedAt:data.updatedAt,
                }
                historyToInsert.push(obj);
            });

            let obj = {
                type: SCHEMA_TYPE.HISTORY,
                data: [historyToInsert]
            }
            MongoDbCrudOpration(companyId,obj,'insertMany').then(()=>{
                resolve({ 'status': true, statusText: 'Added HISTORY'});
            }).catch((err) => {
                reject({ status: false, error: err });
            })
        } catch (error) {
            reject({status: false, error: error});
        }
    })
}

exports.removeCommentCount = (companyId,projectId,sprintId,taskId,parentTaskId = '') => {
    return new Promise((resolve,reject) => {
        try {
            const sprintFieldName = `sprint_${projectId}_${sprintId}_comments`;
            const taskFieldName = `task_${projectId}_${sprintId}_${taskId}_comments`;
            let parentTaskField = ``;
            if(parentTaskId !== '') {
                parentTaskField = `parentTask_${projectId}_${sprintId}_${parentTaskId}_comments`
            }
            let obj = {
                type: dbCollections.USERID,
                data: [{
                    [taskFieldName]: {
                        $gte: 0
                    }
                }]
            }
            MongoDbCrudOpration(companyId,obj,"find").then((responsee) => {
                if(responsee.length > 0){
                    let obj = {
                        type: dbCollections.USERID,
                        data: [{
                            [taskFieldName]: {
                                $gte: 0
                            }
                        }]
                    }
                    MongoDbCrudOpration(companyId,obj,"find").then((ele)=>{
                        if (ele && ele.length) {
                            let count = 0;
                            let countFunction = (row) => {
                                if (count >= ele.length) {
                                    responsee.forEach((x) => {
                                        let prevCount = x[taskFieldName] || 0;
                                        updateSprintCount(companyId,[x], taskFieldName, sprintFieldName, parentTaskField, -prevCount, () => {
                                            resolve(true);
                                        })
                                    })
                                } else {
                                    let upObj = {
                                        type: dbCollections.USERID,
                                        data: [
                                            { _id: row._id },
                                            { 
                                                $unset: {
                                                    [taskFieldName]: ""
                                                }
                                            },
                                            { returnDocument: 'after' }
                                        ]
                                    }
                                    MongoDbCrudOpration(companyId,upObj,"findOneAndUpdate").then((dty)=>{
                                        socketEmitter.emit('update', { 
                                            type: "update", 
                                            data: dty, 
                                            module: 'userIdNotification' 
                                        });
                                        count++;
                                        countFunction(ele[count]);
                                    }).catch((error) => {
                                        logger.error(`${error} ERROR IN MONGO QUERY`);
                                        count++;
                                        countFunction(ele[count]);
                                    });
                                }
                            }
                            countFunction(ele[count]);
                        }
                    }).catch((error) => {
                        logger.error(`${error} ERROR IN MONGO QUERY`);
                    })
                }else{
                    resolve(true);
                }
            })
        } catch (error) {
            reject(error)
        }
    })
}

exports.updateHistoryCollection = (companyId,task,newProjectData,taskId) => {
    return new Promise((resolve,reject) => {
        try {
            let obj = {
                type: SCHEMA_TYPE.HISTORY,
                data: [
                    {
                        TaskId: new mongoose.Types.ObjectId(task._id)
                    },
                    {
                        ProjectId : newProjectData.id,
                        TaskId : taskId
                    },
                    { timestamps: false }
                ]
            }
            MongoDbCrudOpration(companyId,obj,"updateMany").then(() => {
                resolve();
            }).catch((error) => {
                logger.error(`${error}ERROR IN UPDATE COMMENTS`);
            })
        } catch (error) {
            reject(error)
        }
    })
}

exports.getTaskCount = async(companyId, sprintId) => {
    try {
        return new Promise(async(resolve,reject) => {
            try {
                const query = {
                    type: dbCollections.TASKS,
                    data: [
                        [
                            {
                                $match: {
                                    sprintId: new mongoose.Types.ObjectId(sprintId),
                                    deletedStatusKey: { $in: [0, 2, undefined] }
                                }
                            },
                            { $count: "count" }
                        ]
                    ]
                };

                const response = await MongoDbCrudOpration(companyId, query, "aggregate");

                const taskCount = response[0]?.count || 0;

                resolve({ success: true, count: taskCount });
            } catch (error) {
                reject(error);
            }
        })
    } catch (error) {
        console.error(`Error fetching task count: ${error}`);
        return { success: false, error: "Error fetching task count" };
    }
}

exports.getTotalSprintCount = async (companyId,sprintId) => {
    return new Promise(async(resolve,reject) => {
        try {
            Promise.allSettled([exports.getTaskCount(companyId, sprintId),getCachedCompanyData(companyId)]).then(async(results) => {
                const resolvedPromises = results.filter((result) => result.status === 'fulfilled');
                if (resolvedPromises.length === 2) {
                    const [sprintCountResult, cachedCompanyResult] = resolvedPromises.map((result) => result.value);

                    const hasPermission = await exports.checkPlanPermission(cachedCompanyResult.data, sprintCountResult.count);

                    resolve(hasPermission);
                }else{
                    resolve(false);
                }
            })
        } catch (error) {
            reject(error);
        }
    })
}

exports.checkPlanPermission = async (companyData, totalCreated) => {
    try {
        let planfeatures = JSON.parse(JSON.stringify(companyData.planFeature));

        let perProjectData = planfeatures?.maxTaskPerSprint;

        if (planfeatures === undefined) {
            return false;
        }

        if (perProjectData === null) {
            return true;
        } else {
            if (perProjectData > totalCreated) {
                return true;
            } else {
                return false;
            }
        }
    } catch (error) {
        logger.error(`Error ${error}`);
        return false;
    }
};

exports.updateTimesheetCollection = (companyId,task,newProjectData,taskId) => {
    return new Promise((resolve,reject) => {
        try {
            let obj = {
                type: SCHEMA_TYPE.TIMESHEET,
                data: [
                    {
                        TicketID: task._id
                    },
                    {
                        ProjectId : newProjectData.id,
                        TicketID : taskId
                    },
                    { timestamps: false }
                ]
            }
            MongoDbCrudOpration(companyId,obj,"updateMany").then(() => {
                resolve();
            }).catch((error) => {
                logger.error(`${error}ERROR IN UPDATE TIMESHEET COLLECTION`);
            })
        } catch (error) {
            reject(error)
        }
    })
}

exports.updateEstimatedTimeCollection = (companyId,task,newProjectData,taskId) => {
    return new Promise((resolve,reject) => {
        try {
            let obj = {
                type: SCHEMA_TYPE.ESTIMATES_TIME,
                data: [
                    {
                        TaskId: task._id
                    },
                    {
                        ProjectId : newProjectData.id ,
                        TaskId : taskId  
                    },
                    { timestamps: false }
                ]
            }
            MongoDbCrudOpration(companyId,obj,"updateMany").then(() => {
                resolve();
            }).catch((error) => {
                logger.error(`${error}ERROR IN UPDATE ESTIMATE TIME COLLECTION`);
            })
        } catch (error) {
            reject(error)
        }
    })
}
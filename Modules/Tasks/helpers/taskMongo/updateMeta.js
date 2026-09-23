const { escapeHtml } = require('../../../../utils/escapeHtml');
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
const { taskNotFound, escapeText, TaskWriteRefusal } = require('../taskWriteFields');

const storedFileName = (storedTask, data) => {
    const stored = ((storedTask && storedTask.attachments) || []).find((file) => file && file.id !== undefined && file.id === data.id);
    return stored ? stored.filename : data.filename;
};

const isPlainItemId = (value) => (typeof value === 'string' && value.trim() !== '' && !value.startsWith('$')) || (typeof value === 'number' && Number.isFinite(value));

/* The ids a checklist operation filters or pulls by; each must be one plain id, never a condition. */
const checklistItemIds = (operation, data, history) => {
    if (operation === 'checklistedit') return [history.updatedId];
    if (['checklistassignee', 'assigneeremove'].includes(operation)) return [history.updateCheckListId, history.assigneeId];
    if (operation === 'checklistremove') return Array.isArray(data) ? data : [data];
    return [];
};
module.exports = {

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
                }

                let obj = {
                    type: schema,
                    data: [
                        queryFilter,
                        queryObj,
                        { returnDocument: 'after' }
                    ]
                }

                MongoDbCrudOpration(companyId, obj, "findOneAndUpdate").then((response) => {
                    if (!response) {
                        reject(taskNotFound());
                        return;
                    }
                    socketEmitter.emit('update', { type: "update", data: response , updatedFields: {}, module: 'task' });
                    resolve({status: true, statusText: `Tag updated successfully`});
                }).catch(reject);

            } catch (error) {
                reject(error);
            }
        })
    },

    /* -------------- UPDATE CHECKLISTS -----------------*/
    updateChecklists({ companyId, projectId, sprintId, taskId, operation, data = {}, historyObj: sentHistory, userData }) {
        return new Promise((resolve, reject) => {
            try {
                const historyObject = { ...(sentHistory || {}), userId: userData.id, Employee_Name: userData.Employee_Name };
                if (operation === 'checklistremove' && !Array.isArray(data)) {
                    reject(new TaskWriteRefusal(400, 'data must list the checklist item ids to remove.'));
                    return;
                }
                if (!checklistItemIds(operation, data, historyObject).filter((value) => value !== undefined && value !== null).every(isPlainItemId)) {
                    reject(new TaskWriteRefusal(400, 'Checklist item ids must be plain ids.'));
                    return;
                }
                const schema = SCHEMA_TYPE.TASKS;
                let queryObj = buildQueryObject(operation, taskId, data, historyObject);
                let obj = { type: schema, data: queryObj };

                MongoDbCrudOpration(companyId, obj, "findOneAndUpdate").then((response)=>{
                    if (!response) {
                        reject(taskNotFound());
                        return;
                    }
                    socketEmitter.emit('update', { type: "update", data: response , updatedFields: {checklistArray: response.checklistArray}, module: 'task' });
                    resolve({ status: true, statusText: "Checklist updated successfully" });

                    let historyData = buildHistoryObject(operation, historyObject);
                    // let notificationObject = buildNotificationObject(operation, historyObject);

                    if (historyData && Object.keys(historyData).length > 0) {
                        HandleHistory('task', companyId, projectId, taskId, {
                            message: historyData.message,
                            key: historyData.key,
                            sprintId: sprintId
                        }, userData).catch(err => {
                            logger.error(`ERROR in history checklist: ${err}`);
                        });
                    }
                }).catch(reject);

            } catch (error) {
                logger.error(`ERROR in update Checklist: ${JSON.stringify(error)}`);
                reject(error);
            }
        })
    },

    /* -------------- UPDATE ATTACHMENTS -----------------*/
    updateAttachments({companyId, sprintId, taskId, taskData, id = "", operation, data = {}, userData, projectData, storedTask}) {
        return new Promise((resolve, reject) => {
            try {

                const schema = SCHEMA_TYPE.TASKS
                let queryObj = {};
                let queryFilter;

                if (operation === 'add') {
                    queryObj.$push = { attachments: data };
                    queryFilter = { _id: new mongoose.Types.ObjectId(taskId) };
                } else {
                    queryFilter = { 
                        _id: new mongoose.Types.ObjectId(taskId),
                    };
                    queryObj.$pull = { attachments: { id: data.id } };
                }

                let obj = {
                    type: schema,
                    data: [
                        queryFilter,
                        queryObj,
                        { returnDocument: 'after' }
                    ]
                }

                MongoDbCrudOpration(companyId, obj, "findOneAndUpdate").then((response) => {
                    if (!response) {
                        reject(taskNotFound());
                        return;
                    }
                    socketEmitter.emit('update', { type: "update", data: response , updatedFields: {attachments: response.attachments}, module: 'task' });
                    resolve({status: true, statusText: "Attachment updated successfully"});

                    let historyObj = {};
                    let notificationObject = {};
                    if(operation === "add") {
                        historyObj = {
                            message: `<b>${userData.Employee_Name}</b> has attached <b>${escapeHtml(data.filename)}</b> on <b>${escapeText(taskData.TaskName)}</b>.`,
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
                        const removedName = storedFileName(storedTask, data);
                        historyObj = {
                            message: `<b>${escapeHtml(removedName)}</b> removed from <b>${escapeText(taskData.TaskName)}</b>&apos;s attchments.`,
                            key: "Task_Attachment_Remove",
                            sprintId: taskData.sprintId,
                        }
                        notificationObject = {
                            'message': taskAttachmentRemove({
                                'ProjectName': projectData.ProjectName,
                                'TaskName': taskData.TaskName,
                                'removeFileName': removedName
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
    },

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
                    if (!result) {
                        reject(taskNotFound());
                        return;
                    }
                    socketEmitter.emit('update', { type: "update", data: result , updatedFields: updateObj, module: 'task' });
                    resolve({status: true, statusText: "Description updated successfully"});
                }).catch(reject);
            } catch (error) {
                logger.error(`Update Discription Error:${error.message}`)
                reject(error);
            }
        })
    },

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
    },

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
    },

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
    },

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
                    if (!response) {
                        reject(taskNotFound());
                        return;
                    }
                    resolve({status: true, statusText: "Checklist added successfully"});
                    socketEmitter.emit('update', { type: "update", data: response , updatedFields: {checklistArray: checklistArray}, module: 'task' });
                    const names = escapeText(checklistArray.map(item => item.name).join(", "));

                    let historyObj = {
                        key: "task_checklist",
                        message: `<b>${userData.Employee_Name}</b> has created new checklist item <b class="text-ellipsis vertical-middle d-inline-block" style="max-width:150px" title="${names}">${names}</b>`,
                        sprintId: sprintId
                    };
                    HandleHistory('task',companyId,projectId,taskId,historyObj,userData).catch((error) => {
                        logger.error(`ERROR in checklist history: ${error.message}`);
                    });
                })
                .catch((error) => {
                    logger.error(`Error in Adding Checklist: ${error.message}`);
                    reject(error)
                })

            } catch (error) {
                logger.error(`ERROR in Adding Checklist: ${JSON.stringify(error)}`);
                reject(error);
            }
        })
    },


    updateTaskTotalEstimate({firebaseObj,projectData ,taskData , obj, userData, storedTask}) {
        return new Promise((resolve,reject) => {
            try {
                const previousEstimate = Number(storedTask && storedTask.totalEstimatedTime) || 0;
                const query = {
                    type: dbCollections.TASKS,
                    data: [
                        {
                            _id: new mongoose.Types.ObjectId(taskData._id)
                        }, {
                            $set: {
                                ...firebaseObj,
                                // AHE — flag the task for the TL on a RE-update (an estimate
                                // already existed). First-time set (previous 0/undefined) never flags.
                                ...(previousEstimate > 0 ? { estimateChangedFlag: true } : {})
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
                    const previousDisplayText = convertToDisplayFormat(previousEstimate);
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
                    // AHE — a RE-update requires a reason; append it to the activity-log message.
                    const reasonText = obj.reason && String(obj.reason).trim()
                        ? ` <b>Reason:</b> ${escapeHtml(String(obj.reason).trim())}`
                        : '';
                    let historyObj = {
                        key: "task_total_estimate",
                        message : `<b>${userData.Employee_Name}</b> has updated total estimated time from <b>${previousDisplayText}</b> to <b>${updatedDisplayText}</b>.${reasonText}`,
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

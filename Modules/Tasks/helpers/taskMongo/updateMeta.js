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
    },

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
    },

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
                }

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
                    socketEmitter.emit('update', { type: "update", data: result , updatedFields: updateObj, module: 'task' });
                    resolve({status: true, statusText: "Description updated successfully"});
                })
            } catch (error) {
                logger.error(`Update Discription Error:${error.message}`)
                reject(error);
            }
        })
    },

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
    },


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
                                ...firebaseObj,
                                // AHE — flag the task for the TL on a RE-update (an estimate
                                // already existed). First-time set (previous 0/undefined) never flags.
                                ...(Number(obj.previousEstimatedTime) > 0 ? { estimateChangedFlag: true } : {})
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
                    // AHE — a RE-update requires a reason; append it to the activity-log
                    // message. Message renders as HTML (v-html), so escape the user text.
                    const escapeHtml = (s) => String(s == null ? '' : s)
                        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                    const reasonText = obj.reason && String(obj.reason).trim()
                        ? ` <b>Reason:</b> ${escapeHtml(String(obj.reason).trim())}`
                        : '';
                    let historyObj = {
                        key: "task_total_estimate",
                        message : `<b>${obj.userName}</b> has updated total estimated time from <b>${previousDisplayText}</b> to <b>${updatedDisplayText}</b>.${reasonText}`,
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

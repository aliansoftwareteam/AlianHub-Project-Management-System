const { dbCollections } = require("../../../Config/collections");
const logger = require("../../../Config/loggerConfig");
const emailNotificationHandlerCtrl = require("../../notification/email-notification-handler/controllerV2")
const {handleNotificationtFun} = require("../../../Modules/notification/prepare-notification-data/controllerV2");
const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const mongoose = require("mongoose");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { myCache } = require("../../../Config/config");

exports.HandleBothNotification = ({ type, companyId, projectId, taskId, folderId, sprintId, object, userData, changeType = '', changeData = {},comments_id = "", mentionUserId = [],isGroupChat}) => {
    return new Promise(async (resolve, reject) => {
        try {
            let projectPath = `${companyId}/${companyId}/${dbCollections.PROJECTS}/${projectId}`
            let path = projectPath;
            if (taskId !== undefined) {
                path = `${projectPath}/${sprintId}/${taskId}`
            }

            let projectData = null;
            let taskData = null;
            if(projectId && ['project', 'tasks', 'task'].includes(type)){
                projectData = await emailNotificationHandlerCtrl.fetchProjectDetailsSingle(companyId, projectId).then(response => {
                    if (response?.length > 0) {
                        return response[0]
                    } else {
                        return null
                    }

                }).catch(error => {
                    // BUG-031 / #85 fix: was a silent `return null` which
                    // turned every DB failure into "no data" downstream.
                    // Log so the failure is visible in ops; still return
                    // null so the notification flow continues (best-effort).
                    logger.error(`HandleBothNotification: fetchProjectDetailsSingle failed: ${error && error.message ? error.message : error}`);
                    return null
                })
            }
            if (taskId && ['tasks', 'task'].includes(type)) {
                taskData = await emailNotificationHandlerCtrl.fetchTaskDetails(companyId, taskId).then(response => {
                    if (response?.length > 0) {
                        return response[0]
                    } else {
                        return null
                    }

                }).catch(error => {
                    // BUG-031 / #85 fix: same pattern as above.
                    logger.error(`HandleBothNotification: fetchTaskDetails failed: ${error && error.message ? error.message : error}`);
                    return null
                })
            }

            if(taskData && ['tasks', 'task'].includes(type)){
                let watchers = taskData?.watchers ? taskData.watchers : [];
                watchers = watchers?.filter((x) => {
                    if (projectData?.watchers?.[x] === "ignore") {
                        return false;
                    } else {
                        if (projectData?.watchers?.[x] === "all_activity") {
                            return true;
                        } else {
                            if (taskId) {
                                return taskData?.watchers?.includes(x);
                            } else {
                                if (folderId && sprintId) {
                                    let folder = Object.values(taskData?.sprintsfolders || {})?.find((x) => x.folderId === folderId);
                                    if (folder) {
                                        let sprint = Object.values(folder?.sprintsObj || {})?.find((x) => x.id === sprintId)
                                        if (sprint) {
                                            return sprint?.watchers?.includes(x);
                                        } else {
                                            return false;
                                        }
                                    } else {
                                        return false;
                                    }
                                } else if (sprintId) {
                                    let sprint = Object.values(taskData?.sprintsObj || {})?.find((x) => x.id === sprintId)
                                    if (sprint) {
                                        return sprint?.watchers?.includes(x);
                                    } else {
                                        return false;
                                    }
                                } else {
                                    return false;
                                }
                            }
                        }
                    }
                })

                if (!watchers?.length) {
                    reject({ status: false, message: "No watchers" });
                    return
                }
                let users = [];
                if (taskId !== undefined) {
                    users = Array.from(new Set([taskData.Task_Leader, ...watchers]));
                } else {
                    users = Array.from(new Set([...taskData.AssigneeUserId, ...doc.data().LeadUserId, ...watchers]));
                }

                var leaderId = ""
                if (taskData?.LeadUserId !== undefined && taskData?.LeadUserId != "") {
                    leaderId = taskData.LeadUserId
                }

                const obj = {
                    "createdAt": new Date(),
                    "key": object.key,
                    "message": object.message,
                    "projectId": projectId,
                    "taskId": taskId || "",
                    "type": type,
                    "userId": userData.id,
                    "assigneeUsers": users,
                    "folderId": folderId || "",
                    "isSelected": false,
                    "notSeen": users,
                    "sprintId": sprintId || "",
                    "updatedAt": new Date(),
                    "companyId": companyId || "",
                    "task_leader_ID": taskData?.Task_Leader || "",
                    "changeType": changeType || "",
                    "changeData": changeData || {},
                    "comments_id": comments_id ? comments_id : ""
                }
                handleNotificationtFun({body:obj})
                    .then((response) => {

                        resolve({ status: true });
                    })
                    .catch((error) => {
                        logger.error(`ERROR in Notification API info::${error.message}`);
                        reject({ status: false, message: error.message });
                    });

            } else if(projectData && type === 'project'){
                let watchers = projectData?.watchers || {};
                let ownerId = userData.companyOwnerId;
                
                let filteredIds = Object.keys(watchers).filter(id =>  watchers[id] === 'all_activity' || (watchers[id] === 'participating_mentions' && mentionUserId?.includes(id)));
                let users = [];
                users = Array.from(new Set([...filteredIds, ...(ownerId ? [ownerId] : [])]));
                const obj = {
                    "createdAt": new Date(),
                    "key": object.key,
                    "message": object.message,
                    "projectId": projectId,
                    "type": type,
                    "userId": userData.id,
                    "assigneeUsers": users,
                    "isSelected": false,
                    "notSeen": users,
                    "updatedAt": new Date(),
                    "companyId": companyId || "",
                    "changeType": changeType || "",
                    "changeData": changeData || {},
                    "comments_id": comments_id ? comments_id : ""
                }
                handleNotificationtFun({body:obj})
                    .then((response) => {

                        resolve({ status: true });
                    })
                    .catch((error) => {
                        logger.error(`ERROR in Notification API info::${error.message}`);
                        reject({ status: false, message: error.message });
                    });
            } else if (['chat'].includes(type)) {
                let chatData = null;
                if (isGroupChat === true) {
                    try {
                        let obj = {
                            type: SCHEMA_TYPE.SPRINTS,
                            data: [{ _id: new mongoose.Types.ObjectId(sprintId) }]
                        };

                        chatData = await MongoDbCrudOpration(companyId, obj, "findOne");

                        if (chatData?.private === false) {
                            const cacheKey = `company_users:${companyId}`;
                            const hasCache = myCache.get(cacheKey);

                            if (hasCache) {
                                userArray = JSON.parse(hasCache);
                                if (userArray?.length) {
                                    chatData.watchers = userArray.filter(x => x.status === 2).map(x => x?._id ? x?.userId : '');
                                }
                            } else {
                                const params = { type: SCHEMA_TYPE.COMPANY_USERS, data: [] };
                                const response = await MongoDbCrudOpration(companyId, params, 'find');
                                chatData.watchers = response.filter(x => x.status === 2).map(x => x?._id ? JSON.parse(JSON.stringify(x?.userId)) : '');
                                myCache.set(cacheKey, JSON.stringify(response), 604800);
                            }
                        } else {
                            chatData.watchers = chatData.watchers && chatData.watchers.length ? chatData.watchers : chatData?.AssigneeUserId && chatData?.AssigneeUserId?.length ? [...chatData?.AssigneeUserId] : []
                        }

                    } catch (error) {
                        logger.error(`Fetch Task Details Notification: ${error.message}`);
                    }
                } else {
                    chatData = await emailNotificationHandlerCtrl.fetchTaskDetails(companyId, taskId).then(response => (response?.length > 0 ? response[0] : null)).catch(() => null);
                }

                let watchers = chatData?.watchers || [];

                if (!watchers.length) {
                    reject({ status: false, message: "No watchers" });
                    return;
                }

                let users = [];
                if (chatData?.Task_Leader) {
                    users = Array.from(new Set([chatData.Task_Leader, ...watchers]));
                } else {
                    users = Array.from(new Set([...(chatData?.AssigneeUserId || []), ...watchers]));
                }

                const obj = {
                    createdAt: new Date(),
                    key: object.key,
                    message: object.message,
                    projectId,
                    taskId: isGroupChat === true ? chatData?._id ? JSON.parse(JSON.stringify(chatData?._id)) : '' : taskId ? taskId : '',
                    type,
                    userId: userData.id,
                    assigneeUsers: users,
                    folderId: folderId || "",
                    isSelected: false,
                    notSeen: users,
                    sprintId: sprintId || "",
                    updatedAt: new Date(),
                    companyId: companyId || "",
                    task_leader_ID: chatData?.Task_Leader || "",
                    changeType: changeType || "",
                    changeData: changeData || {},
                    comments_id: comments_id || ""
                };

                handleNotificationtFun({ body: obj }).then(() => resolve({ status: true })).catch((error) => {
                    logger.error(`ERROR in Notification API info::${error.message}`);
                    reject({ status: false, message: error.message });
                });
            }
        } catch (error) {

            logger.error(`ERROR in Notification API info::${error.message}`);
            reject({ status: false, message: error.message });
        }
    });
}
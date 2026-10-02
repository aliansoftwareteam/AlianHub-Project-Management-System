const HandleHistoryref = require("../Tasks/helpers/helper");
const logger = require("../../Config/loggerConfig");
const MongoQ = require("../../utils/mongo-handler/mongoQueries")
const mongoose = require("mongoose")
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const RequestQueue = require("../../utils/requestQueue");
const { dbCollections } = require("../../Config/collections");
const { unsetAllCounts } = require("../notification-count/controller");
const requestQueue = new RequestQueue();
const { getCachedCompanyData } = require('../../utils/planHelper');
const { stepCompanyCounters } = require("../Company/helpers/companyCounters");
const scrumRules = require("./scrumRules");
const { escapeHtml } = require("../../utils/escapeHtml");
const { storedNames, notifySprintCreated, notifyFolderCreated } = require("./helpers/sprintHistory");
const { ListWriteError, prepareSprintUpdate, prepareFolderUpdate } = require("./helpers/listWrites");
const { folderForList, parentForNewFolder, prepareFolderMove } = require("./helpers/folderTree");
const socketEmitter = require("../../event/socketEventEmitter");

const namedFolderId = (folder) => (folder && typeof folder === 'object' && folder.folderId ? folder.folderId : '');

exports.addSprint = async (req, res) => {
    try {
        const { folder, projectId } = req.body;
        if (namedFolderId(folder)) await folderForList(String(req.headers['companyid'] || ''), projectId, namedFolderId(folder));
    } catch (error) {
        if (!refuseListWrite(res, error)) res.json({ status: false, statusText: error.message });
        return;
    }
    exports.addSprintFun(req).then((data) => {
        res.json(data);
        const { companyId, projectId, sprintName, mainChat, isPreCompany } = req.body;
        if (data && data.status === true && !mainChat && !isPreCompany) {
            notifySprintCreated({ companyId, projectId, sprintName, actorId: req.uid })
                .catch((error) => logger.error(`sprint created notification failed: ${(error && error.message) || error}`));
        }
    }).catch((error) => {
        res.json(error);
    })
}

exports.updateChannelsCounts = (companyId, isPrivate, type) => {
    return new Promise((resolve, reject) => {
        const channelType = isPrivate ? 'privateChannels' : 'publicChannels';
        const step = type === 'inc' ? 1 : -1;

        requestQueue.enqueue(() => {
            stepCompanyCounters(companyId, {
                [`projectCount.${channelType}`]: step,
                'projectCount.channels': step
            })
            .then((response) => {
                // BUG-030 / #84 fix: pre-fix code went straight to
                // `JSON.stringify(response.data)` and then read deeply
                // nested fields. If response.data was undefined (race
                // with a newly-created project, or a malformed write)
                // the chain crashed with TypeError on `data.projectCount.privateChannels`.
                // Guard against missing layers and resolve(false) (the
                // "not allowed" outcome) instead of throwing.
                if (!response || response.data === undefined || response.data === null) {
                    logger.warn(`checkProjectCount: missing response.data for company ${companyId}`);
                    resolve(false);
                    return;
                }
                if (response) {
                    const data = JSON.parse(JSON.stringify(response.data));

                    const projectCount = data.projectCount || {};
                    const planFeature = data.planFeature || {};
                    const privateChannels = projectCount.privateChannels || 0;
                    const maxPrivateChannels = planFeature.maxPrivateChannels;
                    const publicChannels = projectCount.publicChannels || 0;
                    const maxPublicChannels = planFeature.maxPublicChannels;

                    if(isPrivate) {
                        if(maxPrivateChannels === null) {
                            resolve(true);
                        } else {
                            const count = maxPrivateChannels - privateChannels;
                            if(count >= 0) {
                                resolve(true);
                            } else {
                                resolve(false);
                            }
                        }
                    } else {
                        if(maxPublicChannels === null) {
                            resolve(true);
                        } else {
                            const count = maxPublicChannels - publicChannels;
                            if(count >= 0) {
                                resolve(true);
                            } else {
                                resolve(false);
                            }
                        }
                    }

                } else {
                    resolve(false);
                }
            })
            .catch(error => reject(error));
        });
    })
}

const ICON_FIELDS = ['type', 'iconName', 'prefix', 'url'];

/* A channel's icon is a Font Awesome glyph (prefix, iconName) or an uploaded image (url). */
const iconFields = (icon) => Object.fromEntries(ICON_FIELDS
    .filter((field) => icon && typeof icon === 'object' && typeof icon[field] === 'string')
    .map((field) => [field, icon[field]]));

exports.addSprintFun = (req) => {
    try {
        return new Promise(async(resolve, reject) => {
            const {companyId, projectId, folder, sprintName, userData, isPreCompany = false, mainChat = false, private: isPrivate = false, sendMessage = true, AssigneeUserId = [], icon,from = '',taskSprintObj = {}} = req.body;
            const sprintObject = {
                tasks : 0,
                private: isPrivate,
                name: sprintName,
                deletedStatusKey : 0,
                projectId : new mongoose.Types.ObjectId(projectId),
                ...iconFields(icon),
            }
            if(mainChat) {
                sprintObject.sendMessage = sendMessage;
                sprintObject.AssigneeUserId = AssigneeUserId;
            }

            if(folder && Object.keys(folder).length && folder.folderId && folder.folderId.length) {
                sprintObject.folderId = new mongoose.Types.ObjectId(folder.folderId);
            }

            const schema = SCHEMA_TYPE.SPRINTS
            let obj = {
                type: schema,
                data: sprintObject
            }
            if (isPreCompany) {
                MongoQ.MongoDbCrudOpration(companyId, obj, "save").then((responsee) => {
                    resolve({ status: true, statusText: "List added successfully",data: responsee});
                }).catch((error) => {
                    logger.error(`ERROR in add sprint function : ${error.message}`);
                    reject({ status: false, statusText: error });
                });
                return;
            }

            if(mainChat) {
                exports.updateChannelsCounts(companyId, isPrivate, 'inc').then((result) => {
                    if(result) {
                        MongoQ.MongoDbCrudOpration(companyId, obj, "save").then((responsee) => {
                            resolve({ status: true, statusText: "List added successfully",data: responsee});
                            if(mainChat) return
                        }).catch((error) => {
                            logger.error(`ERROR in add sprint function : ${error.message}`);
                            reject({ status: false, statusText: error });
                        });
                    } else {
                        exports.updateChannelsCounts(companyId, isPrivate, 'dec');
                        resolve({ status: false, statusText: "Channels creation limits have been exceeded" });
                    }
                })
            } else {
                const hasPermission = await exports.getPerProjectCount(companyId,projectId,dbCollections.SPRINTS);
                if(hasPermission) {
                    MongoQ.MongoDbCrudOpration(companyId, obj, "save").then(async (responsee) => {
                        resolve({ status: true, statusText: "List added successfully",data: responsee});
                        if(mainChat) return

                        const stored = await storedNames(companyId, { projectId, folderId: folder && folder.folderId });
                        let historyObj = {};
                        if(folder && folder.folderId !== "") {
                            historyObj = {
                                'message': `<b>${escapeHtml(userData.Employee_Name)}</b> has created new <b>Sprint</b> as <b>${escapeHtml(sprintName)}</b> in <b>${escapeHtml(stored.folderName)}</b> folder in <b>${escapeHtml(stored.projectName)}</b> project ${from !== '' ? `from the (<b>${taskSprintObj.taskFodlerName ? "/" + escapeHtml(taskSprintObj.taskFodlerName) : ""}${escapeHtml(taskSprintObj.taskSprintName)}/${escapeHtml(sprintName)}</b>) task.` : ''}.`,
                                'key' : 'Sub_Sprint_Created',
                            }
                        } else {
                            historyObj = {
                                'message': `<b>${escapeHtml(userData.Employee_Name)}</b> has created new <b>Sprint</b> as <b>${escapeHtml(sprintName)}</b> in <b>${escapeHtml(stored.projectName)}</b> project ${from !== '' ? `from the (<b>${escapeHtml(taskSprintObj.taskSprintName)}/${escapeHtml(sprintName)}</b>) task.` : ''}.`,
                                'key' : 'Create_Sprint',
                            }
                        }
    
                        HandleHistoryref.HandleHistory('project', companyId, projectId, null, historyObj, userData).catch((error) => {
                            logger.error(`ERROR in handle history : ${error.message}`);
                        });
                    }).catch((error) => {
                        logger.error(`ERROR in add sprint function : ${error.message}`);
                        reject({ status: false, statusText: error });
                    });
                }else{
                    resolve({ status: false, statusText: "Upgrade your plan",isUpgrade: true});
                }
            }

        })
    } catch (error) {
        logger.error(`ERROR : ${error.message}`);
        return Promise.reject({ status: false, statusText:error });
    }
};

/**
 * Rename the sprint named in the route. The sprint id is taken from req.params.id and
 * never from the body: read endpoints return sprints as `_id`, so keying the update on
 * `prevData.id` renamed nothing whenever a client handed the server its own object back,
 * and answered success anyway. History names the sprint's stored name, not `prevData`.
 */
const LIST_NAME_LIMIT = 50;

exports.editSprintName = (req, res) => {
    try {
        const { projectId, userData, mainChat = false } = req.body;
        const companyId = String(req.headers['companyid'] || '');
        const { id } = req.params;
        const sprintName = typeof req.body.sprintName === 'string' ? req.body.sprintName.trim() : '';
        if (!sprintName || sprintName.length > LIST_NAME_LIMIT) {
            res.status(400).send({ status: false, statusText: `A name of 1 to ${LIST_NAME_LIMIT} characters is required.` });
            return;
        }

        const object = {
            type: SCHEMA_TYPE.SPRINTS,
            data: [
                { _id: new mongoose.Types.ObjectId(id) },
                { $set: { name: sprintName } },
                { returnDocument: 'after' }
            ]
        };

        const before = { type: SCHEMA_TYPE.SPRINTS, data: [{ _id: new mongoose.Types.ObjectId(id) }, { name: 1, folderId: 1 }] };
        MongoQ.MongoDbCrudOpration(companyId, before, "findOne").catch(() => null).then(async (previous) => {
            const response = await MongoQ.MongoDbCrudOpration(companyId, object, "findOneAndUpdate");
            if (!response) {
                res.send({ status: false, statusText: "Sprint not found" });
                return;
            }

            res.send({status: true, statusText: "Sprint_updated_successfully", data: response});
            if (mainChat) return;

            const folderId = previous && previous.folderId ? String(previous.folderId) : '';
            const stored = await storedNames(companyId, { projectId, folderId });
            const previousName = (previous && previous.name) || '';
            const historyObj = folderId
                ? {
                    'message': `<b>${escapeHtml(userData.Employee_Name)}</b> has changed <b>Sprint</b> name from <b>${escapeHtml(previousName)}</b> to <b>${escapeHtml(sprintName)}</b> in <b>${escapeHtml(stored.folderName)}</b> folder in <b>${escapeHtml(stored.projectName)}</b> project.`,
                    'key' : 'Sub_Sprint_Created',
                }
                : {
                    'message': `<b>${escapeHtml(userData.Employee_Name)}</b> has changed <b>Sprint</b> name from <b>${escapeHtml(previousName)}</b> to <b>${escapeHtml(sprintName)}</b> in <b>${escapeHtml(stored.projectName)}</b> project.`,
                    'key' : 'Create_Sprint',
                };

            HandleHistoryref.HandleHistory('project', companyId, projectId, null, historyObj, userData)
            .catch((error) => {
                logger.error("ERROR in handle history", error.message);
            });
        }).catch((error)=>{
            logger.error(`EDIT SPRINT ERROR : ${error}`);
            if (!res.headersSent) res.send({status: false, statusText: "Error in sprit update"});
        });
    } catch (error) {
        logger.error(error.message);
        res.send({status: false, statusText: error.message});
    }
};

/* Only a sprint whose container is a main-chat project was ever counted: addSprintFun
   increments the channel quota for `mainChat` creates alone, while this route accepts
   any sprint id. Decrementing for a plain project list is what drove the live counters
   negative, and a negative quota can never be spent back. */
const isCountedChannel = async (companyId, sprint) => {
    if (!sprint || !sprint.projectId) return false;
    const container = await MongoQ.MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.MAIN_CHATS,
        data: [{ _id: new mongoose.Types.ObjectId(String(sprint.projectId)) }, { _id: 1 }]
    }, 'findOne').catch(() => null);
    return Boolean(container);
};

/**
 * Soft-delete a main-chat channel.
 *
 * Deliberately NOT folded into updateSprint (which project sprints share): the
 * company's channel quota has to come back down. addSprintFun increments
 * projectCount.channels and .privateChannels/.publicChannels on create and only
 * decrements them when the create itself fails — so without this a deleted channel
 * would keep counting against the plan limit forever.
 *
 * Messages are left in place. Comments are keyed by sprintId and this is a soft
 * delete, so removing them would be destructive and unrecoverable.
 */
exports.deleteChannel = (req, res) => {
    try {
        const { companyId } = req.body;
        const { id } = req.params;

        const object = {
            type: SCHEMA_TYPE.SPRINTS,
            data: [
                // The filter is what makes the quota step once: a channel already in the
                // trash matches nothing, so a repeated delete cannot decrement again.
                { _id: new mongoose.Types.ObjectId(id), deletedStatusKey: { $ne: 1 } },
                { $set: { deletedStatusKey: 1 } },
                { returnDocument: 'after' }
            ]
        };

        MongoQ.MongoDbCrudOpration(companyId, object, "findOneAndUpdate").then(async (response) => {
            if (!response) {
                res.send({ status: false, statusText: "Channel not found" });
                return;
            }

            res.send({ status: true, statusText: "Sprint_deleted_successfully", data: response });

            if (!(await isCountedChannel(companyId, response))) return;

            // Read the private flag off the STORED document, not the request body, so
            // a stale or forged value cannot decrement the wrong quota bucket.
            exports.updateChannelsCounts(companyId, !!response.private, 'dec')
            .catch((error) => {
                logger.error(`DELETE CHANNEL COUNT ERROR : ${error}`);
            });
        }).catch((error) => {
            logger.error(`DELETE CHANNEL ERROR : ${error}`);
            res.send({ status: false, statusText: error.message });
        });
    } catch (error) {
        logger.error(error.message);
        res.send({ status: false, statusText: error.message });
    }
};

const SPRINT_UPDATE_FAILED = 'The list could not be updated.';

const refuseListWrite = (res, error) => {
    if (!(error instanceof ListWriteError)) return false;
    res.status(error.statusCode).json({ status: false, statusText: error.message, message: error.message });
    return true;
};

exports.updateSprint = async (req, res) => {
    try {
        const companyId = String(req.headers['companyid'] || '');
        const prepared = await prepareSprintUpdate(companyId, req.uid, req.params.id, req.body.updateObject);
        if (!prepared) {
            res.json({ status: false, statusText: "Sprint not found" });
            return;
        }
        const { update, projectId } = prepared;
        res.json(await exports.updateSprintFun({
            params: req.params,
            body: { ...req.body, companyId, projectId, projectData: { ...(req.body.projectData || {}), id: projectId }, updateObject: update },
        }));
    } catch (error) {
        if (!refuseListWrite(res, error)) res.status(500).json({ status: false, statusText: SPRINT_UPDATE_FAILED });
    }
};

exports.updateSprintFun = (req) => {
    return new Promise((resolve, reject) => {
        try {
            const { companyId, projectId, folderId = null, updateObject, userData, sprintName = null, folderName = "", projectData = null, mainChat = false, historyData } = req.body;
            const { id } = req.params;

            // The Scrum lifecycle fields are written by the start/complete actions alone.
            const lifecycleField = scrumRules.findLifecycleWrite(updateObject);
            if (lifecycleField) {
                resolve({
                    status: false,
                    statusText: `"${lifecycleField}" is managed by the sprint lifecycle. Use the start or complete action instead.`,
                });
                return;
            }

            const schema = SCHEMA_TYPE.SPRINTS;
            let obj = {
                type: schema,
                data: [
                    { _id: new mongoose.Types.ObjectId(id) },
                    { ...updateObject },
                    {returnDocument: 'after'},
                ]
            }

            // Archiving (2) or closing (5) cascades the key onto EVERY task in
            // the sprint, done or not — which is exactly the rollover a running
            // Scrum sprint must not have done behind its back. Only look the
            // sprint up for those two values, so the denormalised `$inc`
            // task-count path stays a single write.
            const writtenStatus = updateObject && updateObject.$set
                && Object.prototype.hasOwnProperty.call(updateObject.$set, 'deletedStatusKey')
                ? Number(updateObject.$set.deletedStatusKey)
                : undefined;

            const lifecycleCheck = (writtenStatus === 2 || writtenStatus === 5)
                ? MongoQ.MongoDbCrudOpration(companyId, {
                    type: schema,
                    data: [{ _id: new mongoose.Types.ObjectId(id) }, 'isScrum state name'],
                }, "findOne").then((current) => {
                    const state = scrumRules.deriveState(current);
                    if (state === scrumRules.STATE_ACTIVE || state === scrumRules.STATE_OVERDUE) {
                        const running = new Error('SPRINT_RUNNING');
                        running.sprintRunning = (current && current.name) || '';
                        throw running;
                    }
                }, () => { /* a failed pre-check must not block an ordinary archive */ })
                : Promise.resolve();

            lifecycleCheck
            .then(() => MongoQ.MongoDbCrudOpration(companyId, obj, "findOneAndUpdate"))
            .then((response) => {
                // Nothing matched: the cascades below would run against a sprint that is
                // not there, and the caller would be told the update landed.
                if (!response) {
                    resolve({ status: false, statusText: "Sprint not found" });
                    return;
                }

                resolve({ status: true, statusText: "Sprint_updated_successfully",data:response });
                if(mainChat) return;

                // CASCADE A FOLDER MOVE ONTO THIS SPRINT'S TASKS.
                // A task carries its folder as `folderObjId` (+ `sprintArray.folderId`/`folderName`),
                // mirrored from its sprint's `folderId` at create/move time (see Tasks/helpers/mongo_helper.js).
                // When a sprint is moved between buckets we only change the SPRINT's folderId here, so without
                // this cascade every task keeps a stale folder -> the task-detail breadcrumb + every route that
                // builds `fs/:folderId` from `task.folderObjId` resolve to the wrong (or no) folder.
                // Detect a genuine move by the presence of the `folderId` key under `$set`
                // (value is the target folder, or null when moving back to root); the denormalised
                // task-count `$inc` updates do not carry it, so they are unaffected.
                if (updateObject && updateObject.$set && Object.prototype.hasOwnProperty.call(updateObject.$set, 'folderId')) {
                    try {
                        const newFolderId = updateObject.$set.folderId || null;
                        const newFolderName = updateObject.$set.folderName || "";
                        const taskMatch = { sprintId: new mongoose.Types.ObjectId(id) };
                        let taskUpdate;
                        if (newFolderId) {
                            // INTO A FOLDER (root->folder or folder->folder)
                            taskUpdate = {
                                $set: {
                                    folderObjId: new mongoose.Types.ObjectId(newFolderId),
                                    'sprintArray.folderId': new mongoose.Types.ObjectId(newFolderId),
                                    'sprintArray.folderName': newFolderName,
                                },
                            };
                        } else {
                            // BACK TO ROOT (folder->root): drop the folder linkage entirely
                            taskUpdate = {
                                $unset: {
                                    folderObjId: '',
                                    'sprintArray.folderId': '',
                                    'sprintArray.folderName': '',
                                },
                            };
                        }
                        const taskFolderUpdateQuery = {
                            type: SCHEMA_TYPE.TASKS,
                            data: [taskMatch, taskUpdate],
                        };
                        MongoQ.MongoDbCrudOpration(companyId, taskFolderUpdateQuery, "updateMany")
                        .catch((error) => {
                            logger.error(`ERROR in cascade folder move to sprint tasks: ${error.message}`);
                        });
                    } catch (error) {
                        logger.error(`ERROR in cascade folder move to sprint tasks: ${error.message}`);
                    }
                }

                if (writtenStatus !== undefined) {
                    try {
                        let dsk = writtenStatus || 0;

                        let taskDeleteStatusKey = 0;
                        let deletedStatusKey;
                        if(!dsk) {
                            deletedStatusKey = 4;
                            taskDeleteStatusKey = 0;
                        } else {
                            deletedStatusKey = 0;
                            if(dsk === 2) {
                                taskDeleteStatusKey = 4
                            } else if(dsk === 5) {
                                taskDeleteStatusKey = 5
                            } else if(dsk === 1) {
                                taskDeleteStatusKey = 1
                            }
                        }

                        try {
                            const taskStatusUpdateQuery = {
                                type: SCHEMA_TYPE.TASKS,
                                data: [
                                    {
                                        ProjectID: new mongoose.Types.ObjectId(projectData ? projectData.id : projectId),
                                        sprintId: id,
                                        deletedStatusKey:deletedStatusKey
                                    },
                                    { $set: {deletedStatusKey: taskDeleteStatusKey}},
                                ]
                            }
                            MongoQ.MongoDbCrudOpration(companyId,taskStatusUpdateQuery,"updateMany")
                            .catch((error) =>{
                                logger.error(`ERROR in update sprint tasks while update task: ${error.message}`);
                            })

                            if(taskDeleteStatusKey !== 0) {
                                unsetAllCounts(companyId, (projectData ? projectData.id : projectId), id)
                                .catch((error) => {
                                    logger.error(`ERORR in update parent count: ${error?.message}`);
                                })
                            }
                        } catch (error) {
                            logger.error(`ERROR in update sprint tasks from updating task deletestatuskey: ${error.message}`);
                        }
                    } catch (error) {
                        logger.error(`ERROR in update sprint tasks: ${error.message}`);
                    }
                }

                // Call histiory function
                let historyObj = {
                    key: "project_sprint",
                    sprintId: id,
                }
                if(writtenStatus) {
                    historyObj.message = `<b>${escapeHtml(userData.Employee_Name)}</b> has ${writtenStatus === 5 ? 'closed' : writtenStatus === 1 ? 'deleted' : 'archived'} <b>${escapeHtml(sprintName)}</b> sprint ${folderId === null ? '' : `in <b>${escapeHtml(folderName)}</b> folder`} in <b>${escapeHtml(projectData.ProjectName)}</b> project.`
                }else if(historyData && Object.keys(historyData).length > 0){
                    historyObj.message = `<b>${escapeHtml(userData.Employee_Name)}</b> has <b>${escapeHtml(historyData.type)}</b> <b>${escapeHtml(historyData.userName)}</b> ${historyData.userName ? historyData.type === 'added' ? 'in' : 'from' : ''} <b>${escapeHtml(sprintName)}</b> sprint ${folderId === null ? '' : `in <b>${escapeHtml(folderName)}</b> folder`} in <b>${escapeHtml(projectData.ProjectName)}</b> project.`
                }
                if (historyObj && Object.keys(historyObj).length) {
                    HandleHistoryref.HandleHistory('project', companyId, projectId, null, historyObj, userData).catch((error) => {
                        logger.error(`ERROR in history: ${error.message}`);
                    });
                }

                // // Call notification function
                // let notificationObject = {
                //     'Type': 'project',
                //     'key': 'project_sprint_removed',
                //     'message': `<strong>${userData.Employee_Name}</strong> has ${updateObject.deletedStatusKey === 0 ? 'restored' : updateObject.deletedStatusKey === 5 ? 'closed' : updateObject.deletedStatusKey === 1 ? 'deleted' : 'archived'} <strong>${sprintName}</strong> sprint ${folderId === null ? '' : `in <b>${folderName}</b> folder`} in <strong>${projectData.ProjectName}</strong> project.`,
                // }
                // if (notificationObject && Object.keys(notificationObject).length) {
                //     HandleNotification({ type: "project", companyId, projectId, folderId: folderId !== null ? folderId : '', sprintId: id || '', object: notificationObject, userData })
                //     .catch((error) => {
                //         logger.error(`ERROR in add notification ${error.message}`);
                //     });
                // }
            })
            .catch((error) => {
                if (error && error.sprintRunning !== undefined) {
                    resolve({
                        status: false,
                        statusText: `"${error.sprintRunning}" is still running. Complete the sprint first — archiving it now would close its unfinished tasks too.`,
                    });
                    return;
                }
                logger.error(`ERROR in update sprint function => ${error}`);
                // After the answer above this is a no-op; before it, the caller would otherwise wait for ever.
                reject({ status: false, statusText: SPRINT_UPDATE_FAILED });
            })
        } catch (error) {
            logger.error(`ERROR ${error.message}`);
            reject({ status: false, statusText: SPRINT_UPDATE_FAILED });
        }
    });
};

/* Other tabs learn only that the company's folders changed, and read them again: see socket/controller/folderSocket.js. */
const announceFolders = (type, companyId) => socketEmitter.emit(type, { type, companyId, module: 'folders' });
exports.announceFolders = announceFolders;

const recordFolderHistory = (companyId, projectId, message, userData) => HandleHistoryref
    .HandleHistory('project', companyId, projectId, null, { message, key: 'Create_Folder' }, userData)
    .catch((error) => {
        logger.error("ERROR in handle history", error.message);
    });

exports.addFolderFun = async ({ companyId, projectId, folderName, parentFolderId }) => {
    const parent = await parentForNewFolder(companyId, projectId, parentFolderId);
    const doc = await MongoQ.MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.FOLDERS,
        data: {
            name: folderName,
            projectId : new mongoose.Types.ObjectId(projectId),
            deletedStatusKey : 0,
            ...(parent ? { parentFolderId: parent._id } : {}),
        },
    }, "save");
    announceFolders('insert', companyId);
    return { doc, parent };
};

exports.addFolder = async (req, res) => {
    try {
        const {projectId, folderName, userData, mainChat = false} = req.body;
        const companyId = String(req.headers['companyid'] || '');
        const { doc, parent } = await exports.addFolderFun({ companyId, projectId, folderName, parentFolderId: req.body.parentFolderId });
        res.send({status: true, statusText: "Folder added successfully",data:doc});
        if(mainChat) return;

        notifyFolderCreated({ companyId, projectId, folderName, actorId: req.uid })
            .catch((error) => logger.error(`folder created notification failed: ${(error && error.message) || error}`));
        storedNames(companyId, { projectId }).then(({ projectName }) => recordFolderHistory(
            companyId,
            projectId,
            `<b>${escapeHtml(userData.Employee_Name)}</b> has created new <b>Folder</b> as <b>${escapeHtml(folderName)}</b> ${parent ? `in <b>${escapeHtml(parent.name)}</b> folder ` : ''}in <b>${escapeHtml(projectName)}</b> project.`,
            userData,
        )).catch((error) => logger.error(`ADD FOLDER HISTORY ERROR : ${error}`));
    } catch (error) {
        if (!refuseListWrite(res, error)) res.send({status: false, statusText: error.message});
    }
};

/* A move writes the folder's parent and nothing else: its sprints and tasks keep pointing at the folder itself. */
exports.moveFolder = async (req, res) => {
    try {
        const { userData } = req.body;
        const { id } = req.params;
        const companyId = String(req.headers['companyid'] || '');

        const prepared = await prepareFolderMove(companyId, id, req.body.parentFolderId);
        const moved = prepared && await MongoQ.MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.FOLDERS,
            data: [{ _id: new mongoose.Types.ObjectId(id) }, prepared.update, { returnDocument: 'after' }],
        }, "findOneAndUpdate");
        if (!moved) {
            res.send({ status: false, statusText: "Folder not found" });
            return;
        }
        res.send({ status: true, statusText: "Folder moved successfully", data: moved });
        announceFolders('update', companyId);

        const { folder, parent, previousParentId } = prepared;
        const parentId = parent ? String(parent._id) : '';
        if (parentId === previousParentId) return;
        const projectId = String(folder.projectId);
        storedNames(companyId, { projectId, folderId: parentId || previousParentId }).then((stored) => recordFolderHistory(
            companyId,
            projectId,
            `<b>${escapeHtml(userData.Employee_Name)}</b> has moved <b>${escapeHtml(folder.name)}</b> folder ${parent ? 'into' : 'out of'} <b>${escapeHtml(stored.folderName)}</b> folder in <b>${escapeHtml(stored.projectName)}</b> project.`,
            userData,
        )).catch((error) => logger.error(`MOVE FOLDER HISTORY ERROR : ${error}`));
    } catch (error) {
        if (!refuseListWrite(res, error)) res.send({status: false, statusText: error.message});
    }
};

/* A task carries its folder's name in sprintArray. The copy follows a rename, and the tasks' own updatedAt stays as it was. */
const renameFolderOnTasks = (companyId, folder) => MongoQ.MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TASKS,
    data: [
        { ProjectID: new mongoose.Types.ObjectId(String(folder.projectId)), folderObjId: new mongoose.Types.ObjectId(String(folder._id)) },
        { $set: { 'sprintArray.folderName': folder.name } },
        { timestamps: false },
    ],
}, "updateMany");

exports.editFolderName = (req, res) => {
    try {
        const {projectId, folderName, userData, mainChat = false} = req.body;
        const {id} = req.params;
        const companyId = String(req.headers['companyid'] || '');

        const obj = {
            type: SCHEMA_TYPE.FOLDERS,
            data: [
                { _id: new mongoose.Types.ObjectId(id) },
                { $set: { name: folderName } },
                {returnDocument: 'after'}
            ]
        }

        storedNames(companyId, { projectId, folderId: id }).then(async (stored) => {
            const response = await MongoQ.MongoDbCrudOpration(companyId, obj, "findOneAndUpdate");
            if (!response) {
                res.send({ status: false, statusText: "Folder not found" });
                return;
            }

            res.send({status: true, statusText: "Folder renamed successfully",data:response});
            announceFolders('update', companyId);
            renameFolderOnTasks(companyId, response)
                .catch((error) => logger.error(`ERROR in renaming the folder on its tasks: ${error.message}`));
            if(mainChat) return;

            recordFolderHistory(
                companyId,
                projectId,
                `<b>${escapeHtml(userData.Employee_Name)}</b> has changed <b>Folder</b> name from <b>${escapeHtml(stored.folderName)}</b> to <b>${escapeHtml(folderName)}</b> in <b>${escapeHtml(stored.projectName)}</b> project.`,
                userData,
            );
        }).catch((error) => {
            logger.error(`EDIT FOLDER ERROR : ${error}`);
            if (!res.headersSent) res.send({status: false, statusText: "Error in folder update"});
        });
    } catch (error) {
        logger.error(error.message);
        res.send({status: false, statusText: error.message});
    }
};

const cascadeOntoSprintTasks = async (companyId, projectId, sprints, { from, to }) => {
    for (const sprintId of sprints) {
        if (to !== 0) {
            unsetAllCounts(companyId, projectId, sprintId)
            .catch((error) => {
                logger.error(`ERORR in update parent count: ${error?.message}`);
            })
        }
        await MongoQ.MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [
                { ProjectID: new mongoose.Types.ObjectId(projectId), sprintId, deletedStatusKey: from },
                { $set: { deletedStatusKey: to } },
            ],
        }, "updateMany").catch((error) => {
            logger.error(`ERROR in update Folder sprint tasks while update task: ${error.message}`);
        });
    }
};

const FOLDER_NOT_FOUND = { status: false, statusText: "Folder not found" };

/*
 * Archives, deletes or restores a folder. `answer` is ready once the folder and its subfolders are
 * written; `cascade` settles when the tasks under them have followed, for a caller that must wait.
 * `fromTrash` is the trash's restore, which also brings back what a delete took.
 */
exports.updateFolderFun = async ({ companyId, id, updateObject, folderName = "", projectData = {}, userData, mainChat = false, fromTrash = false }) => {
    const prepared = await prepareFolderUpdate(companyId, id, updateObject, { fromTrash });
    if (!prepared) return { answer: FOLDER_NOT_FOUND, cascade: Promise.resolve() };
    const { update, status: writtenStatus, cascade, projectId, sprints, subfolders } = prepared;

    const folder = await MongoQ.MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.FOLDERS,
        data: [
            { _id: new mongoose.Types.ObjectId(id) },
            update,
            {returnDocument: 'after'}
        ]
    }, "findOneAndUpdate");
    if (!folder) return { answer: FOLDER_NOT_FOUND, cascade: Promise.resolve() };

    if (subfolders.length) {
        await MongoQ.MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.FOLDERS,
            data: [
                { _id: { $in: subfolders.map((subfolderId) => new mongoose.Types.ObjectId(subfolderId)) }, projectId: new mongoose.Types.ObjectId(projectId), deletedStatusKey: cascade.from },
                { $set: { deletedStatusKey: cascade.to } },
            ],
        }, "updateMany");
    }
    announceFolders('update', companyId);

    const answer = {
        status: true,
        statusText: "Folder updated successfully",
        data: folder,
        subfolders: subfolders.map((subfolderId) => ({ _id: subfolderId, deletedStatusKey: cascade.to })),
    };
    if (mainChat) return { answer, cascade: Promise.resolve() };

    HandleHistoryref.HandleHistory('project', companyId, projectId, null, {
        message: `<b>${escapeHtml(userData.Employee_Name)}</b> has ${writtenStatus === 0 ? 'restored' : writtenStatus === 1 ? 'deleted' : 'archieved'} <b>${escapeHtml(folderName)}</b> folder in <b>${escapeHtml(projectData.ProjectName)}</b> project.`,
        key: "project_sprint_removed",
    }, userData).catch((error) => {
        logger.error("ERROR in history: ", error.message);
    });

    return {
        answer,
        cascade: cascadeOntoSprintTasks(companyId, projectId, sprints, cascade)
            .catch((error) => logger.error(`ERROR in update Folder sprint tasks: ${error.message}`)),
    };
};

exports.updateFolder = async (req, res) => {
    try {
        const { folderName, projectData, userData, mainChat, updateObject } = req.body;
        const { answer } = await exports.updateFolderFun({
            companyId: String(req.headers['companyid'] || ''),
            id: req.params.id,
            updateObject,
            folderName,
            projectData,
            userData,
            mainChat,
        });
        res.send(answer);
    } catch (error) {
        if (refuseListWrite(res, error)) return;
        logger.error(`UPDATE FOLDER ERROR : ${error}`);
        res.send({status: false, statusText: error.message});
    }
};

exports.getSprintCount = async(companyId, projectId,collectionName) => {
    try {
        return new Promise(async(resolve,reject) => {
            try {
                let object = {
                    type: collectionName,
                    data:[[
                        {
                            $match: {projectId: new mongoose.Types.ObjectId(projectId)}
                        },
                        {$count: "count"}
                    ]]
                }

                const response = await MongoQ.MongoDbCrudOpration(companyId,object, "aggregate");

                const sprintCount = response[0]?.count || 0;

                resolve({ success: true, count: sprintCount });
            } catch (error) {
                reject(error);
            }
        })
    } catch (error) {
        console.error(`Error fetching task count: ${error}`);
        return { success: false, error: "Error fetching task count" };
    }
}

exports.getPerProjectCount = (companyId,projectId,collectionName) => {
    return new Promise((resolve,reject) => {
        try {
            Promise.allSettled([exports.getSprintCount(companyId, projectId,collectionName),getCachedCompanyData(companyId)]).then(async(results) => {
                const resolvedPromises = results.filter((result) => result.status === 'fulfilled');
                if (resolvedPromises.length === 2) {
                    const [sprintCountResult, cachedCompanyResult] = resolvedPromises.map((result) => result.value);

                    const hasPermission = await exports.checkPlanPermission(cachedCompanyResult.data, sprintCountResult.count,collectionName);

                    resolve(hasPermission);
                }else{
                    resolve(false);
                }
            })
            // Without this the promise never settles when anything above throws, and every caller
            // waits forever — addSprintFun in particular, which is how a project ended up with no
            // list and no tasks rather than with an error.
            .catch((error) => {
                logger.error(`ERROR in getPerProjectCount: ${error && error.message}`);
                resolve(false);
            })
        } catch (error) {
            logger.error(`ERROR in getPerProjectCount ${error.message}`);
            reject(error);
        }
    })
}

exports.checkPlanPermission = async (companyData, totalCreated, type) => {
    try {
        // A company document without planFeature is normal for a few seconds during creation, and
        // JSON.parse(JSON.stringify(undefined)) throws rather than returning undefined. That throw
        // used to escape into a .then with no .catch, so the caller's promise never settled and
        // sprint creation hung forever. No plan recorded means no per-project cap.
        if (!companyData || companyData.planFeature === undefined || companyData.planFeature === null) {
            return true;
        }
        let planfeatures = JSON.parse(JSON.stringify(companyData.planFeature));

        let perProjectData = type === 'sprints' ? planfeatures?.sprintPerProject : planfeatures?.folderPerProject;

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

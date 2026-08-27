const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose")
const logger = require("../../Config/loggerConfig");
const { handleTaskAttachmentsDuplicateFunctionality } = require(`../../common-storage/common-${process.env.STORAGE_TYPE}.js`);
const { replaceObjectKey } = require("../Auth/helper");
const socketEmitter = require('../../event/socketEventEmitter');
const { escapeRegex } = require("../../utils/escapeRegex");
const { parseMentionIds } = require("./helpers/parseMentions");
const { maybeReplyAsAlianSafe, emitCommentInsert } = require("./helpers/alianReply");
const { handleNotificationtFun } = require("../notification/prepare-notification-data/controllerV2");
const { getRoleType, isPrivileged } = require("../../Config/permissionGuard");
const { buildPaginatedCommentMatch, isHexCastError } = require("./helpers/commentThread");

/* @mention delivery: record the mention (feeds the in-app "mentions" tab, which
 * queries the mentions collection by mentionIds) and fire the notification
 * pipeline (in-app + push + email) targeted at the mentioned users — NOT the
 * task watchers. Best-effort: never throws, so it can't break comment save. */
const notifyMentions = async (companyId, comment, mentionIds) => {
    const mentionerId = String(comment.userId || comment.createdBy || '');
    const taskId = comment.taskId && String(comment.taskId) !== 'default' ? String(comment.taskId) : '';
    const projectId = String(comment.projectId || '');
    const sprintId = comment.sprintId ? String(comment.sprintId) : '';

    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.MENTIONS,
        data: {
            comment_id: String(comment._id),
            comment_message: comment.message || '',
            comment_type: taskId ? 'task' : 'project',
            mentionIds,
            userId: mentionerId,
            projectId,
            taskId,
            sprintId,
            type: 'mention',
            notSeen: mentionIds,
        },
    }, 'save').catch((err) => logger.error(`[mentions] record save failed: ${err.message}`));

    try {
        await handleNotificationtFun({ body: {
            createdAt: new Date(),
            key: "comments_I'm_@mentioned_in",
            message: comment.message || '',
            projectId,
            taskId,
            type: 'task',
            userId: mentionerId,
            assigneeUsers: mentionIds,
            folderId: comment.folderId ? String(comment.folderId) : '',
            isSelected: false,
            notSeen: mentionIds,
            sprintId,
            updatedAt: new Date(),
            companyId,
            changeType: 'mention',
            comments_id: String(comment._id),
        } });
    } catch (err) {
        logger.error(`[mentions] notification dispatch failed: ${err.message}`);
    }
};

/**
 * This endpoint is used to save data in comments collection
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.save = async (req, res) => {
    try {
        const { data } = req.body
        const convertData = replaceObjectKey(data, ["objId"]);
        // SEC (AHE-3834) — the author is the authenticated caller, never a client-supplied
        // userId. Legit callers already send their own id, so this is transparent.
        if (req.uid) convertData.userId = req.uid;
        // @mentions: extract the [Name](userId) tokens the editor inserts so the
        // comment records who was mentioned (drives the mention notification).
        const mentionIds = parseMentionIds(convertData.message);
        const query = {
            type: SCHEMA_TYPE.COMMENTS,
            data: {
                ...convertData,
                ...(mentionIds.length ? { mentionIds } : {}),
                ...(convertData.taskId !== 'default' ? { taskId: convertData.taskId } : {})
            }
        }

        const response = await MongoDbCrudOpration(req.headers['companyid'], query, "save");
        emitCommentInsert(response);
        if (mentionIds.length && response && response._id) {
            notifyMentions(req.headers['companyid'], response, mentionIds)
                .catch((err) => logger.error(`[mentions] notify failed: ${err.message}`));
        }
        if (response && response._id) {
            maybeReplyAsAlianSafe(req.headers['companyid'], response, req.uid)
                .catch((err) => logger.error(`[alian] notify failed: ${err.message}`));
            const { maybeRunAgentWritebackSafe } = require('../Automations/helpers/agentWritebackRun');
            maybeRunAgentWritebackSafe({
                type: 'comment_created',
                companyId: req.headers['companyid'],
                uid: req.uid,
                taskId: response.taskId,
                comment: response,
            }).catch((err) => logger.error(`[writeback] comment failed: ${err.message}`));
        }
        if (response) {
            return res.status(200).json({ status: true, data: response || {}  });
        } else {
            return res.status(404).json({ status: false });
        }

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while save data in comments collection",
            error: error
        });
    }
}

/**
 * This endpoint is used to update data in comments collection
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.update = async (req, res) => {
    try {
        const { id, isProjectComment, data, options = {} } = req.body;

        if (!id) {
            return res.status(400).json({
                status: false,
                message: `'id' parameter is required.`
            });
        }

        // SEC (AHE-3834) — a comment may only be edited/soft-deleted by its author
        // (or an Owner/Admin). Non-owners may ONLY toggle `pinnedMessage` — the sole
        // field the UI lets any member change. Matches every legit caller (edit/delete
        // are own-only in the UI, pin is member-wide) and blocks editing/deleting/
        // re-authoring someone else's message.
        const existingComment = await MongoDbCrudOpration(
            req.headers['companyid'],
            { type: SCHEMA_TYPE.COMMENTS, data: [{ _id: new mongoose.Types.ObjectId(id) }] },
            'findOne'
        );
        if (!existingComment) {
            return res.status(404).json({ status: false, message: 'Comment not found.' });
        }
        const isOwner = String(existingComment.userId) === String(req.uid);
        const changedKeys = Object.keys(data || {});
        const pinOnly = changedKeys.length > 0 && changedKeys.every((k) => k === 'pinnedMessage');
        if (!isOwner && !pinOnly) {
            const roleType = await getRoleType(req.headers['companyid'], req.uid);
            if (!isPrivileged(roleType)) {
                return res.status(403).json({ status: false, message: 'Not allowed to modify this comment.' });
            }
        }

        const params = {
            type: SCHEMA_TYPE.COMMENTS,
            data: [
                {
                    _id: new mongoose.Types.ObjectId(id)
                },
                {
                    $set: {
                        ...data,
                        ...(data.message !== undefined ? { mentionIds: parseMentionIds(data.message) } : {}),
                        ...((data.taskId && data.taskId !== 'default') ? { taskId: new mongoose.Types.ObjectId(data.taskId) } : {})
                    }
                },
                {
                    returnDocument: 'after',
                    ...options
                }
            ]
        }

        const response = await MongoDbCrudOpration(req.headers['companyid'], params, 'findOneAndUpdate');
        if(!isProjectComment){
            socketEmitter.emit('update', { type: "update", data: response , updatedFields: {}, module: 'comments' });
        }else{
            socketEmitter.emit('update', { type: "update", data: response , updatedFields: {}, module: 'comments_project' });
        }
        if (response) {
            return res.status(200).json({ status: true,data: response || {} });
        } else {
            return res.status(404).json({ status: false });
        }

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while update data from comments collection",
            error: error
        });
    }
}

/**
 * This endpoint is used to get message form comments collection
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.getPaginatedMessages = async (req, res) => {
    try {
        const {
            projectId,
            taskId = null,
            sprintId = null,
            isDefault = null,
            skipValue = 0,
            batchLimit = 25,
            mainChat = false,
            tabLeaveTime = null
        } = req.query;

        const match = buildPaginatedCommentMatch({ projectId, taskId, sprintId, isDefault, mainChat });
        if (match.error) {
            return res.status(400).json({ status: false, message: match.error, data: [] });
        }

        const and = match.and;
        if (tabLeaveTime) and.push({ updatedAt: { $gte: new Date(Number(tabLeaveTime)) } });

        const searchResultMatch = {
            $match: { $and: and }
        };

        const sortOption = {
            $sort: {
                createdAt: -1,
                _id: 1,
            }
        };

        const skipStage = { $skip: parseInt(skipValue) };

        const limitStage = tabLeaveTime ? null : { $limit: parseInt(batchLimit) };
        
        const aggregationPipeline = [searchResultMatch, sortOption, skipStage, ...(limitStage ? [limitStage] : [])];

        const params = {
            type: SCHEMA_TYPE.COMMENTS,
            data: [aggregationPipeline],
        };

        const response = await MongoDbCrudOpration(req.headers['companyid'], params, 'aggregate');

        return res.status(200).json({ status: true, data: response || [] });

    } catch (error) {
        if (isHexCastError(error)) {
            return res.status(400).json({ status: false, message: 'A valid projectId is required.', data: [] });
        }
        return res.status(500).json({
            status: false,
            message: 'Internal Server Error',
            error: error.message,
        });
    }
}

/**
 * This endpoint is used to search message form comments collection in main chat search box
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.searchMessageFromMainChat = async (req, res) => {
    try {
        const { searchText, projectId, sprintId, taskId, skip = 0, limit = 25, isPinnedMessage, sort = 'asc' } = req.query;

        const query = {
            type: SCHEMA_TYPE.COMMENTS,
            data: [
                {
                    projectId: new mongoose.Types.ObjectId(projectId),
                    ...(sprintId ? {sprintId: new mongoose.Types.ObjectId(sprintId)} : { project: true }),
                    taskId: (taskId && taskId !== "default") ? new mongoose.Types.ObjectId(taskId) : 'default',
                    ...((isPinnedMessage === "true") ? { pinnedMessage: true } : {}),
                    ...(searchText && searchText !== ''
                        ? {
                              $or: [
                                  // mediaName is the GENERATED storage filename
                                  // ("My_Report_1739..pdf"), so searching the name the
                                  // user actually sees only matched by luck — spaces and
                                  // punctuation are rewritten on upload. Search the
                                  // original name too.
                                  { mediaOriginalName: { $regex: escapeRegex(searchText), $options: "i" } },
                                  { mediaName: { $regex: escapeRegex(searchText), $options: "i" } },
                                  { message: { $regex: escapeRegex(searchText), $options: "i" } }
                              ]
                          }
                        : {}),
                    // BUG-032 / #86 fix: legacy comments may not have an
                    // isDeleted field. Using `$ne: true` keeps them in results
                    // while still excluding soft-deleted ones (consistent with
                    // searchComments).
                    isDeleted: { $ne: true }
                },
                {},
                // Oldest-first stays the default so the existing pinned-messages /
                // filter sidebar is unaffected; free-text search opts into
                // newest-first, where the recent hit is the one you want.
                { sort: { createdAt: sort === 'desc' ? -1 : 1 } },
                { skip: parseInt(skip) },
                { limit: parseInt(limit) }
            ]
        };

        const response = await MongoDbCrudOpration(req.headers['companyid'], query, 'find');

        return res.status(200).json({ status: true, data: response || [] });

    } catch (error) {
        return res.status(500).json({
            status: false,
            message: 'Internal Server Error',
            error: error.message
        });
    }
}

/**
 * This endpoint is used to filter comments in global advance filter
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.searchComments = async (req, res) => {
    try {
        const {
            searchText = '',
            filterQuery = {},
            pids = [],
            skip = 0,
            batchSize = 20,
            sortBy = 'createdAt',
        } = req.body;

        // Parse inputs and prepare default values
        const searchStr = searchText.toString();
        const parsedFilterQuery = typeof filterQuery === 'string' ? JSON.parse(filterQuery) : filterQuery;
        const additionalFilter = parsedFilterQuery && Object.keys(parsedFilterQuery).length ? { ...parsedFilterQuery } : {};
        const projectIds = Array.isArray(pids) ? pids : pids.split(',').map(id => id.trim());
        const convertedProjectIds = projectIds.map(id => new mongoose.Types.ObjectId(id));
        const skipValue = parseInt(skip);
        const batchSizeValue = parseInt(batchSize);


        // Aggregation stages
        const searchResultMatch = {
            $match: {
                $and: [
                    { ...additionalFilter },
                    { projectId: { $in: convertedProjectIds } },
                    { isDeleted: { $ne: true } },
                    ...(searchStr
                        ? [
                            {
                                $or: [
                                    { message: { $regex: escapeRegex(searchStr), $options: "i" } },
                                    { mediaURL: { $regex: escapeRegex(searchStr), $options: "i" } },
                                    { mediaName: { $regex: escapeRegex(searchStr), $options: "i" } },
                                    { mediaOriginalName: { $regex: escapeRegex(searchStr), $options: "i" } },
                                ],
                            },
                        ]
                        : []),
                ],
            },
        }

        const sprintLookup = {
            $lookup: {
                from: 'sprints',
                localField: 'sprintId',
                foreignField: '_id',
                as: 'sprintArray',
                pipeline: [
                    {
                        $match: {
                            deletedStatusKey: 0
                        }
                    }
                ]
            }
        }
        if (req.body?.roleType === 1 || req.body?.roleType === 2) {
            sprintLookup.$lookup.pipeline.push({
                $project: {
                    name: 1,
                    folderId: 1,
                    isAccessible: 1,
                },
            });
        } else{
            sprintLookup.$lookup.pipeline.push(
                {
                    $addFields: {
                        isAccessible: {
                            $cond: {
                                if: { $eq: ['$private', true] },
                                then: { $in: [req.body.userId, '$AssigneeUserId'] },
                                else: true,
                            },
                        },
                    },
                },
                {
                    $match: {
                        isAccessible: true,
                    },
                },
                {
                    $project: {
                        name: 1,
                        folderId: 1,
                        isAccessible: 1,
                    },
                }
            );
        }

        const folderLookup = {
            $lookup: {
                from: 'folders',
                localField: "sprintArray.folderId",
                foreignField: '_id',
                as: 'folderArray',
                pipeline: [
                    {
                        $match: {
                            deletedStatusKey: 0
                        }
                    },
                    {
                        $project: {
                            name: 1,
                        }
                    }
                ]
            }
        };

        const sprintUnwind = { $unwind: { path: '$sprintArray', preserveNullAndEmptyArrays: true } };

        const folderUnwind = { $unwind: { path: '$folderArray', preserveNullAndEmptyArrays: true } };

        const checkIsSprint = {$match: {'sprintArray.isAccessible':true}};

        const sortOption = {
            $sort: {
                [sortBy === 'last_update' ? 'updatedAt' : 'createdAt']: -1,
                _id: 1,
            }
        };

        const skipStage = { $skip: skipValue };

        const limitStage = { $limit: batchSizeValue };

        const aggregationPipeline = [
            searchResultMatch,
            sprintLookup,
            sprintUnwind,
            ...(req.body?.roleType !== 1 && req.body?.roleType !== 2 ? [checkIsSprint] : []),
            folderLookup,
            folderUnwind,
            sortOption,
            skipStage,
            limitStage
        ];

        const params = {
            type: SCHEMA_TYPE.COMMENTS,
            data: [aggregationPipeline],
        };

        const response = await MongoDbCrudOpration(req.headers['companyid'], params, 'aggregate');

        return res.status(200).json({ status: true, data: response || [] });

    } catch (error) {
        logger.error(`Error in searchComments hook: ${error}`)
        return res.status(500).json({
            status: false,
            message: 'Internal Server Error',
            error: error.message,
        });
    }
}

/**
 * This function is used to update comment sprint
 * @param {*} projectId 
 * @param {*} companyId 
 * @returns 
 */
exports.updateCommentSprint = (projectId, companyId) => {
    return new Promise((resolve, reject) => {
        try {
            let findObj = {
                type: SCHEMA_TYPE.SPRINTS,
                data: [{ projectId: new mongoose.Types.ObjectId(projectId) }],
            };
            let updatePromises = [];
            MongoDbCrudOpration(companyId, findObj, "find").then(async (resp) => {
                resp.forEach((sprint) => {
                    let legacyId = sprint.legacyId ? sprint.legacyId : '';
                    let sprintId = JSON.parse(JSON.stringify(sprint._id));
                    if (legacyId) {
                        const updateObj = {
                            type: SCHEMA_TYPE.COMMENTS,
                            data: [
                                {
                                    $expr: {
                                        $eq: [{ $toString: "$sprintId" }, legacyId]
                                    },
                                    projectId: new mongoose.Types.ObjectId(projectId)
                                },
                                { sprintId: new mongoose.Types.ObjectId(sprintId) }
                            ]
                        }
                        const promise = MongoDbCrudOpration(companyId, updateObj, "updateMany").catch((err) => {
                            console.error(err, "ERROR IN IF UPDATE MANY");
                        })
                        updatePromises.push(promise);
                    } else {
                        console.info("ELSE IN COMMENT");
                    }
                })
            })
            Promise.allSettled(updatePromises).then(() => {
                resolve();
            }).catch((error) => {
                console.error(error, "ERROR IN ALL SETTLED");
                reject();
            });
        } catch (error) {
            reject();
            console.error(error, "ERROR IN UPDATE COMMENTS:");
        }
    })
}

/**
 * This funciton is used to update comment collection
 * @param {*} companyId 
 * @param {*} task 
 * @param {*} sprintObj 
 * @param {*} newProjectData 
 * @returns 
 */
exports.updateCommentCollection = (companyId, task, sprintObj, newProjectData,taskId) => {
    return new Promise((resolve, reject) => {
        try {
            let obj = {
                type: SCHEMA_TYPE.COMMENTS,
                data: [
                    {
                        sprintId: new mongoose.Types.ObjectId(task.sprintId),
                        taskId: new mongoose.Types.ObjectId(task._id)
                    },
                    {
                        sprintId: new mongoose.Types.ObjectId(sprintObj.id),
                        projectId: new mongoose.Types.ObjectId(newProjectData.id),
                        taskId: new mongoose.Types.ObjectId(taskId)
                    },
                    { timestamps: false }
                ]
            }
            MongoDbCrudOpration(companyId, obj, "updateMany").then(() => {
                resolve();
            }).catch((error) => {
                logger.error(`${error}ERROR IN UPDATE COMMENTS`);
            })
        } catch (error) {
            reject(error)
        }
    })
}

/**
 * This function is used to add comment collection
 * @param {*} companyId 
 * @param {*} projectData 
 * @param {*} task 
 * @param {*} newTask 
 * @param {*} sprintObj 
 * @returns 
 */
exports.addCommentCollection = (companyId, projectData, task, newTask, sprintObj) => {
    return new Promise(async (resolve, reject) => {
        try {
            const comment = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMMENTS, data: [{ taskId: task._id }] }, "find").then((querySnapshot) => {
                if (querySnapshot.length === 0) {
                    return []
                } else {
                    return querySnapshot
                }
            })
            const commentsToInsert = [];

            comment.forEach((cmt) => {
                let parsedMap = JSON.parse(JSON.stringify(cmt));
                let newMediaURL = '';

                if (parsedMap.mediaURL) {
                    const previousUrl = parsedMap.mediaURL;
                    let lastSlashIndex = previousUrl.lastIndexOf('/');
                    let fileName = previousUrl.substring(lastSlashIndex + 1);
                    newMediaURL = `Project/${projectData.id}/${sprintObj.id}/${newTask.id}/Comments/${fileName}`;
                    handleTaskAttachmentsDuplicateFunctionality(companyId, previousUrl, newMediaURL);
                }

                const obj = {
                    ...parsedMap,
                    taskId: new mongoose.Types.ObjectId(newTask.id),
                    sprintId: new mongoose.Types.ObjectId(sprintObj.id),
                    projectId: new mongoose.Types.ObjectId(projectData.id),
                    mediaURL: newMediaURL
                };
                delete obj._id;

                commentsToInsert.push(obj);
            });
            let obj = {
                type: SCHEMA_TYPE.COMMENTS,
                data: [commentsToInsert]
            }
            MongoDbCrudOpration(companyId, obj, 'insertMany').then(() => {
                resolve({ 'status': true, statusText: 'Added COMMENTS' });
            }).catch((err) => {
                reject({ status: false, error: err });
            })
        } catch (error) {
            reject({ status: false, error: error });
        }
    })
}
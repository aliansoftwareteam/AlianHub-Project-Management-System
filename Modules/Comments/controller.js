const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose")
const logger = require("../../Config/loggerConfig");
const { handleStoredFileCopy } = require(`../../common-storage/common-${process.env.STORAGE_TYPE}.js`);
const { replaceObjectKey } = require("../Auth/helper");
const socketEmitter = require('../../event/socketEventEmitter');
const { escapeRegex } = require("../../utils/escapeRegex");
const { escapeCommentFields } = require("./helpers/plainText");
const { getRoleType, isPrivileged } = require("../../Config/permissionGuard");
const { sprintIdentities, visibleSprintExpr } = require("../Sprints/helpers/sprintVisibility");
const { commentThreadAccess, refuseThread } = require("./helpers/threadAccess");
const { threadOf, canPostToThread, canChangeComment, changesThreadOrAuthor, liveModuleOf } = require("./helpers/threadWriteAccess");
const { resolveMentionIds, deliverMentions } = require("./helpers/commentNotifications");
const { taskIdMatch } = require("./helpers/taskIdMatch");
const { isThreadFile, mayCarryMedia, refuseMedia } = require("./helpers/commentFileKeys");
const { judge: judgeDownload } = require("../storage/downloadScope");
const { withoutAssignment, withoutThreadState, placeReply } = require("./helpers/commentThreads");
const { notifyReply } = require("./helpers/threadNotices");
const { parseAgentMentionIds, parseOwnAiMentionIds } = require("./helpers/parseMentions");
const { withoutAiFields } = require("./helpers/aiActor");
const { withoutImportFields } = require("./helpers/importFields");
const { bumpUnreadCounts } = require("./helpers/unreadBumps");
const { isChatMessage, holdsThreads, replyLookup, withThreadSummary, readable, keptRootIds, announceThread } = require("./helpers/chatThreads");
const { withoutServerOwnedFields } = require("./helpers/serverOwnedFields");
const { keptFromCaller } = require("./helpers/conversationRows");

/* A comment an agent run writes never starts agents, so agents cannot start each other.
 * Required on use: the agent modules are only needed by a comment that names an agent. */
const startMentionedAgents = async (req, companyId, comment) => {
    if (!parseAgentMentionIds(comment.message).length) return;
    const { resolveActor, isAgent } = require("../Agents/actor");
    const actor = await resolveActor(req);
    if (actor.runId) return;
    await require("../Agents/triggers").fromComment(companyId, {
        authorId: comment.userId, taskId: comment.taskId, message: comment.message,
        ...(isAgent(actor) ? { postedBy: actor, path: `${req.method} ${String(req.originalUrl || '').split('?')[0]}`, ip: req.ip || '' } : {}),
    });
};

/* Only a signed-in person names their own connected AI: a comment written through a token or by an agent hands nothing over. */
const namesOwnAi = (req, message) => !req.apiToken && !req.mcp && !req.agentRun && parseOwnAiMentionIds(message).length > 0;

const handToOwnAi = async (req, companyId, comment) => {
    if (!namesOwnAi(req, comment.message)) return;
    await require("../Agents/manager/workQueue").handOverFromComment(companyId, { authorId: comment.userId, taskId: comment.taskId, message: comment.message });
};

const askOwnAi = async (req, companyId, saved) => {
    if (!namesOwnAi(req, saved.message)) return;
    await require("../Agents/manager/chatQuestions").fromChatMessage(companyId, saved);
};

/* A question for a person's own AI is what its author last wrote as a signed-in person: any other change of a
 * message that asked one, an owner's or an admin's included, takes the question back. */
const ownAiFollowsChange = async (req, companyId, before, after) => {
    const concerned = Boolean(before.ownAiAsk) || [before.message, after.message].some((message) => parseOwnAiMentionIds(message).length > 0);
    if (!concerned) return;
    const byAuthor = String(before.userId) === String(req.uid) && !req.apiToken && !req.mcp && !req.agentRun;
    await require("../Agents/manager/chatQuestions").afterMessageChange(companyId, { before, after, byAuthor });
};

/* A summary kept for a task was made from its comments: it goes when one of them is deleted, and is marked as
 * behind when one is edited. A failure here leaves a summary that says less than it should, never a failed write.
 * Required on use: only a delete or an edit needs the store. */
const keptSummaryFollows = async (companyId, comment, { deleted, edited }) => {
    if (!comment.taskId || comment.taskId === 'default' || (!deleted && !edited)) return;
    const kept = require("../AI/taskAiValues");
    await Promise.resolve()
        .then(() => (deleted ? kept.forgetSummary(companyId, comment.taskId) : kept.markSummaryBehind(companyId, comment.taskId)))
        .catch((error) => logger.error(`[comments] kept summary of task ${comment.taskId}: ${error.message}`));
};

const writeOptionsFrom = (options) => {
    if (options === undefined) return {};
    const valid = Boolean(options) && typeof options === 'object' && !Array.isArray(options)
        && Object.keys(options).every((key) => key === 'timestamps' && typeof options[key] === 'boolean');
    return valid ? options : null;
};

exports.save = async (req, res) => {
    try {
        const { data } = req.body
        const companyId = req.headers['companyid'];
        const placement = await placeReply(companyId, withoutImportFields(withoutAiFields(withoutAssignment(escapeCommentFields(replaceObjectKey(data, ["objId"]))))));
        if (!placement.allowed) return refuseThread(res, placement);
        const convertData = placement.data;
        // SEC (AHE-3834) — the author is the authenticated caller, never a client-supplied
        // userId. Legit callers already send their own id, so this is transparent.
        if (req.uid) convertData.userId = req.uid;
        const thread = threadOf(convertData);
        const access = await canPostToThread(companyId, req.uid, thread);
        if (!access.allowed) return refuseThread(res, access);
        if (!(await mayCarryMedia(companyId, req.uid, convertData, convertData.mediaURL))) return refuseMedia(res);
        const chatThread = Boolean(placement.parent) && await isChatMessage(companyId, placement.parent);
        const mentionIds = await resolveMentionIds(companyId, convertData.userId, thread, convertData.message);
        const query = {
            type: SCHEMA_TYPE.COMMENTS,
            data: {
                ...withoutServerOwnedFields(convertData),
                mentionIds,
                ...(convertData.taskId !== 'default' ? { taskId: convertData.taskId } : {})
            }
        }

        const response = await MongoDbCrudOpration(companyId, query, "save");
        if (response && response._id) {
            await startMentionedAgents(req, companyId, { ...thread, userId: convertData.userId, message: convertData.message })
                .catch((err) => logger.error(`[mentions] agents not started: ${err.message}`));
            await handToOwnAi(req, companyId, { ...thread, userId: convertData.userId, message: convertData.message })
                .catch((err) => logger.error(`[mentions] task not handed over: ${err.message}`));
        }
        socketEmitter.emit('insert', { type: "insert", data: response , updatedFields: {}, module: placement.parent ? 'comments' : liveModuleOf(response || convertData), companyId });
        const saved = response && response._id && (typeof response.toObject === "function" ? response.toObject() : response);
        if (saved) {
            await askOwnAi(req, companyId, saved).catch((err) => logger.error(`[mentions] own AI not asked: ${err.message}`));
        }
        if (saved && !placement.parent) {
            bumpUnreadCounts(companyId, saved, mentionIds)
                .catch((err) => logger.error(`[comments] unread counts not raised: ${err.message}`));
        }
        if (mentionIds.length && saved) {
            deliverMentions(companyId, { ...saved, folderId: convertData.folderId }, mentionIds)
                .then((failures) => failures.forEach((err) => logger.error(`[mentions] delivery failed: ${(err && err.message) || JSON.stringify(err)}`)))
                .catch((err) => logger.error(`[mentions] delivery failed: ${err.message}`));
        }
        if (placement.parent && response && response._id) {
            notifyReply(companyId, response, placement.parent, mentionIds, { chat: chatThread })
                .catch((err) => logger.error(`[comments] reply notice failed: ${err.message}`));
        }
        if (chatThread && saved) {
            await announceThread(companyId, saved.parentId)
                .catch((err) => logger.error(`[comments] thread count not sent: ${err.message}`));
        }
        const ai = response && response._id
            ? await require("../AI/aiMention").acceptFromComment(req, companyId, response)
                .catch((err) => { logger.error(`[ai-mention] not accepted: ${err.message}`); return null; })
            : null;
        const agents = response && response._id
            ? await Promise.resolve().then(() => require("../Agents/chatAgents").fromChatMessage(req, companyId, response))
                .catch((err) => { logger.error(`[agent-chat] not started: ${err.message}`); return null; })
            : null;
        if (response) {
            return res.status(200).json({ status: true, data: response || {}, ...(ai ? { ai } : {}), ...(agents ? { agents: agents.agents } : {}) });
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

exports.update = async (req, res) => {
    try {
        const { id } = req.body;
        const data = withoutImportFields(withoutAiFields(withoutThreadState(escapeCommentFields(req.body.data))));

        if (!id) {
            return res.status(400).json({
                status: false,
                message: `'id' parameter is required.`
            });
        }
        const options = writeOptionsFrom(req.body.options);
        if (!options) {
            return res.status(400).json({ status: false, message: "'options' may only carry timestamps (true or false)." });
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
        const commentNotFound = () => res.status(404).json({ status: false, message: 'Comment not found.' });
        if (!existingComment) return commentNotFound();
        const access = await canChangeComment(req.headers['companyid'], req.uid, existingComment);
        if (!access.allowed) return commentNotFound();
        if (changesThreadOrAuthor(existingComment, data)) {
            return res.status(400).json({ status: false, message: 'A comment cannot move to another thread or author.' });
        }
        const namesNewMedia = Object.prototype.hasOwnProperty.call(data || {}, 'mediaURL')
            && String(data.mediaURL || '') !== String(existingComment.mediaURL || '');
        if (namesNewMedia && !(await mayCarryMedia(req.headers['companyid'], req.uid, existingComment, data.mediaURL))) return refuseMedia(res);
        const isOwner = String(existingComment.userId) === String(req.uid);
        const changedKeys = Object.keys(data || {});
        const pinOnly = changedKeys.length > 0 && changedKeys.every((k) => k === 'pinnedMessage');
        if (!isOwner && !pinOnly) {
            const roleType = await getRoleType(req.headers['companyid'], req.uid);
            if (!isPrivileged(roleType)) {
                return res.status(403).json({ status: false, message: 'Not allowed to modify this comment.' });
            }
        }

        const changes = withoutServerOwnedFields(data);
        delete changes.mentionIds;
        const mentionIds = changes.message !== undefined
            ? await resolveMentionIds(req.headers['companyid'], existingComment.userId, threadOf(existingComment), changes.message)
            : undefined;
        const params = {
            type: SCHEMA_TYPE.COMMENTS,
            data: [
                {
                    _id: new mongoose.Types.ObjectId(id)
                },
                {
                    $set: {
                        ...changes,
                        ...(mentionIds ? { mentionIds } : {}),
                        ...((data.taskId && data.taskId !== 'default') ? { taskId: new mongoose.Types.ObjectId(data.taskId) } : {})
                    }
                },
                { returnDocument: 'after', ...options }
            ]
        }

        const companyId = req.headers['companyid'];
        const response = await MongoDbCrudOpration(companyId, params, 'findOneAndUpdate');
        socketEmitter.emit('update', { type: "update", data: response , updatedFields: {}, module: liveModuleOf(existingComment), companyId });
        const deletionChanged = changedKeys.includes('isDeleted') && Boolean(data.isDeleted) !== Boolean(existingComment.isDeleted);
        if (response && (deletionChanged || changes.message !== undefined)) {
            await ownAiFollowsChange(req, companyId, existingComment, response).catch((err) => logger.error(`[mentions] own AI did not follow the change: ${err.message}`));
        }
        if (response) await keptSummaryFollows(companyId, existingComment, { deleted: deletionChanged && Boolean(data.isDeleted), edited: changes.message !== undefined });
        if (response && existingComment.parentId && deletionChanged && await isChatMessage(companyId, existingComment)) {
            await announceThread(companyId, existingComment.parentId)
                .catch((err) => logger.error(`[comments] thread count not sent: ${err.message}`));
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

        const companyId = req.headers['companyid'];
        const thread = { projectId, sprintId, taskId };
        const access = await commentThreadAccess(companyId, req.uid, thread);
        if (!access.allowed) return refuseThread(res, access);

        const threaded = holdsThreads(taskId);
        const keptRoots = threaded && String(mainChat) === 'true' && await isChatMessage(companyId, thread)
            ? await keptRootIds(companyId, thread)
            : [];

        const searchResultMatch = {
            $match: {
                $and: [
                    { projectId: new mongoose.Types.ObjectId(projectId) },
                    access.match,
                    // `$ne: true` keeps documents written before the flag existed. A deleted chat message
                    // that still has thread replies stays, as a placeholder for its thread.
                    keptRoots.length
                        ? { $or: [{ isDeleted: { $ne: true } }, { _id: { $in: keptRoots } }] }
                        : { isDeleted: { $ne: true } },
                    { parentId: null },
                    ...(sprintId ? [{ sprintId: new mongoose.Types.ObjectId(sprintId) }] : []),
                    ...(tabLeaveTime ? [{ updatedAt: { $gte: new Date(Number(tabLeaveTime)) } }] : []),
                    ...(!isDefault && mainChat
                        ? [{ taskId: "default" }]
                        : taskId
                            ? [{ taskId: taskIdMatch(taskId) }]
                            : [{ project: true }]),
                ]
            }
        };

        const sortOption = {
            $sort: {
                createdAt: -1,
                _id: 1,
            }
        };

        const skipStage = { $skip: parseInt(skipValue) };

        const limitStage = tabLeaveTime ? null : { $limit: parseInt(batchLimit) };
        
        const aggregationPipeline = [searchResultMatch, sortOption, skipStage, ...(limitStage ? [limitStage] : []), ...(threaded ? [replyLookup] : [])];

        const params = {
            type: SCHEMA_TYPE.COMMENTS,
            data: [aggregationPipeline],
        };

        const response = await MongoDbCrudOpration(companyId, params, 'aggregate');

        return res.status(200).json({ status: true, data: (response || []).map((row) => readable(withThreadSummary(row))) });

    } catch (error) {
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

        const access = await commentThreadAccess(req.headers['companyid'], req.uid, { projectId, sprintId, taskId });
        if (!access.allowed) return refuseThread(res, access);

        const query = {
            type: SCHEMA_TYPE.COMMENTS,
            data: [
                {
                    projectId: new mongoose.Types.ObjectId(projectId),
                    ...(sprintId ? {sprintId: new mongoose.Types.ObjectId(sprintId)} : { project: true }),
                    taskId: taskId ? taskIdMatch(taskId) : 'default',
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
                    isDeleted: { $ne: true },
                    $and: [access.match]
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
        const privileged = isPrivileged(await getRoleType(req.headers['companyid'], req.uid));

        // Parse inputs and prepare default values
        const searchStr = searchText.toString();
        const parsedFilterQuery = typeof filterQuery === 'string' ? JSON.parse(filterQuery) : filterQuery;
        const additionalFilter = parsedFilterQuery && Object.keys(parsedFilterQuery).length ? { ...parsedFilterQuery } : {};
        const projectIds = Array.isArray(pids) ? pids : pids.split(',').map(id => id.trim());
        const convertedProjectIds = projectIds.map(id => new mongoose.Types.ObjectId(id));
        const skipValue = parseInt(skip);
        const batchSizeValue = parseInt(batchSize);
        const chatKeptFromCaller = await keptFromCaller(req.headers['companyid'], req.uid);

        const searchResultMatch = {
            $match: {
                $and: [
                    { ...additionalFilter },
                    { projectId: { $in: convertedProjectIds } },
                    { isDeleted: { $ne: true } },
                    chatKeptFromCaller,
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
        /* Legacy sprints hold folderId as text, and the folder $lookup below matches BSON types strictly. */
        const sprintFields = {
            $project: {
                name: 1,
                folderId: { $convert: { input: '$folderId', to: 'objectId', onError: '$folderId', onNull: '$folderId' } },
                isAccessible: 1,
            },
        };
        if (privileged) {
            sprintLookup.$lookup.pipeline.push(sprintFields);
        } else{
            /* The assignee list holds user ids and `tId_<teamId>`, and the caller comes from the
             * session: a body userId would let a client read someone else's private sprints. */
            const identities = await sprintIdentities(req.headers['companyid'], req.uid);
            sprintLookup.$lookup.pipeline.push(
                {
                    $addFields: {
                        isAccessible: visibleSprintExpr(identities),
                    },
                },
                {
                    $match: {
                        isAccessible: true,
                    },
                },
                sprintFields
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
            ...(privileged ? [] : [checkIsSprint]),
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
exports.updateCommentSprint = async (projectId, companyId) => {
    try {
        const sprints = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.SPRINTS,
            data: [{ projectId: new mongoose.Types.ObjectId(projectId) }],
        }, "find");
        await Promise.allSettled((sprints || []).filter((sprint) => sprint.legacyId).map((sprint) => {
            const updateObj = {
                type: SCHEMA_TYPE.COMMENTS,
                data: [
                    {
                        $expr: { $eq: [{ $toString: "$sprintId" }, sprint.legacyId] },
                        projectId: new mongoose.Types.ObjectId(projectId)
                    },
                    { sprintId: new mongoose.Types.ObjectId(String(sprint._id)) }
                ]
            };
            return MongoDbCrudOpration(companyId, updateObj, "updateMany").catch((err) => {
                logger.error(`ERROR IN UPDATE MANY updateCommentSprint: ${err}`);
            });
        }));
    } catch (error) {
        logger.error(`ERROR IN UPDATE COMMENTS: ${error}`);
        throw error;
    }
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
                        taskId: taskIdMatch(task._id)
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
/* Only a file in the comment's own thread folder that the person duplicating may read is copied,
 * and it alone: the storage copy used to take every file beside it. Any other key is kept as it is. */
const copiedMediaKey = async (companyId, actorId, comment, folder) => {
    const key = comment.mediaURL;
    if (!key) return '';
    if (!isThreadFile(comment, key) || !(await judgeDownload({ companyId, uid: actorId, key })).allowed) return key;
    const copy = `${folder}/${key.substring(key.lastIndexOf('/') + 1)}`;
    try {
        await handleStoredFileCopy(companyId, key, copy);
        return copy;
    } catch (error) {
        logger.error(`comment file not copied to the duplicate: ${error.message || error}`);
        return key;
    }
};

exports.addCommentCollection = (companyId, projectData, task, newTask, sprintObj, userData) => {
    return new Promise(async (resolve, reject) => {
        try {
            const comment = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMMENTS, data: [{ taskId: taskIdMatch(task._id) }] }, "find").then((querySnapshot) => {
                if (querySnapshot.length === 0) {
                    return []
                } else {
                    return querySnapshot
                }
            })
            const commentsToInsert = [];

            const folder = `Project/${projectData.id}/${sprintObj.id}/${newTask.id}/Comments`;
            for (const cmt of comment) {
                let parsedMap = JSON.parse(JSON.stringify(cmt));
                const newMediaURL = await copiedMediaKey(companyId, userData && userData.id, parsedMap, folder);

                const obj = {
                    ...parsedMap,
                    taskId: new mongoose.Types.ObjectId(newTask.id),
                    sprintId: new mongoose.Types.ObjectId(sprintObj.id),
                    projectId: new mongoose.Types.ObjectId(projectData.id),
                    mediaURL: newMediaURL
                };
                delete obj._id;

                commentsToInsert.push(obj);
            }
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
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose")
const logger = require("../../Config/loggerConfig");
const { handleTaskAttachmentsDuplicateFunctionality } = require(`../../common-storage/common-${process.env.STORAGE_TYPE}.js`);
const { replaceObjectKey } = require("../Auth/helper");
const socketEmitter = require('../../event/socketEventEmitter');
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
        const query = {
            type: SCHEMA_TYPE.COMMENTS,
            data: {
                ...convertData,
                ...(convertData.taskId !== 'default' ? { taskId: convertData.taskId } : {})
            }
        }

        const response = await MongoDbCrudOpration(req.headers['companyid'], query, "save");
        if (data?.objId?.projectId && data?.objId?.taskId && data?.objId?.sprintId) {
            socketEmitter.emit('insert', { type: "insert", data: response , updatedFields: {}, module: 'comments' });
        } else if(data?.taskId === "default"){
            socketEmitter.emit('insert', { type: "insert", data: response , updatedFields: {}, module: 'comments' });
        }
        else {
            socketEmitter.emit('insert', { type: "insert", data: response , updatedFields: {}, module: 'comments_project' });
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

        const params = {
            type: SCHEMA_TYPE.COMMENTS,
            data: [
                {
                    _id: new mongoose.Types.ObjectId(id)
                },
                {
                    $set: {
                        ...data,
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

        const searchResultMatch = {
            $match: {
                $and: [
                    { projectId: new mongoose.Types.ObjectId(projectId) },
                    ...(sprintId ? [{ sprintId: new mongoose.Types.ObjectId(sprintId) }] : []),
                    ...(tabLeaveTime ? [{ updatedAt: { $gte: new Date(Number(tabLeaveTime)) } }] : []),
                    ...(!isDefault && mainChat
                        ? [{ taskId: "default" }]
                        : taskId
                            ? [{ taskId: taskId !== 'default' ?  new mongoose.Types.ObjectId(taskId) : taskId }]
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
        
        const aggregationPipeline = [searchResultMatch, sortOption, skipStage, ...(limitStage ? [limitStage] : [])];

        const params = {
            type: SCHEMA_TYPE.COMMENTS,
            data: [aggregationPipeline],
        };

        const response = await MongoDbCrudOpration(req.headers['companyid'], params, 'aggregate');

        return res.status(200).json({ status: true, data: response || [] });

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
        const { searchText, projectId, sprintId, taskId, skip = 0, limit = 25, isPinnedMessage } = req.query;

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
                                  { mediaName: { $regex: new RegExp(`${searchText}`, "i") } },
                                  { message: { $regex: new RegExp(`${searchText}`, "i") } }
                              ]
                          }
                        : {}),
                    isDeleted: false
                },
                {},
                { sort: { createdAt: 1 } },
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
                                    { message: { $regex: searchStr, $options: "i" } },
                                    { mediaURL: { $regex: searchStr, $options: "i" } },
                                    { mediaName: { $regex: searchStr, $options: "i" } },
                                    { mediaOriginalName: { $regex: searchStr, $options: "i" } },
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
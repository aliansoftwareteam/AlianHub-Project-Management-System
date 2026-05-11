const mongoose = require("mongoose")
const logger = require("../../Config/loggerConfig");
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { replaceObjectKey } = require("../auth/helper");

/**
 * Helper functions
 */
const extractTaskData = () => ({
    attachments: { $arrayElemAt: ["$taskData.attachments", "$$index"] },
    folderId: { $arrayElemAt: ["$taskData.folderObjId", "$$index"] },
    sprintId: { $arrayElemAt: ["$taskData.sprintId", "$$index"] },
    ProjectID: { $arrayElemAt: ["$taskData.ProjectID", "$$index"] },
    _id: { $arrayElemAt: ["$taskData._id", "$$index"] },
    TaskName: { $arrayElemAt: ["$taskData.TaskName", "$$index"] },
})

const filterData = (inputField, compareField) => ({
    $arrayElemAt: [
        {
            $filter: {
                input: inputField,
                as: "item",
                cond: {
                    $eq: [
                        { $toString: "$$item._id" },
                        {
                            $toString: {
                                $arrayElemAt: [compareField, 0],
                            },
                        },
                    ],
                },
            },
        },
        0,
    ],
})

const extractCommentData = () => ({
    type: { $arrayElemAt: ["$commentData.type", "$$index"] },
    attachments: { $arrayElemAt: ["$commentData.mediaURL", "$$index"] },
    sprintId: { $arrayElemAt: ["$commentData.sprintId", "$$index"] },
    project: { $arrayElemAt: ["$commentData.project", "$$index"] },
    projectId: { $arrayElemAt: ["$commentData.projectId", "$$index"] },
    taskId: { $arrayElemAt: ["$commentData.taskId", "$$index"] },
    mediaOriginalName: { $arrayElemAt: ["$commentData.mediaOriginalName", "$$index"] },
    mediaURL: { $arrayElemAt: ["$commentData.mediaURL", "$$index"] },
})

/**
 * This is the endopint which is return all the fatch all the saved global advance filters.
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.getFilter = async (req, res) => {
    try {
        const { userId, filterType } = req.params;

        let params = {
            type: SCHEMA_TYPE.GLOBALFILTER,
            data: [
                {
                    userId: userId,
                    filter: 'advancedFilter',
                    typeFilter: filterType
                }
            ]
        }

        const response = await MongoDbCrudOpration(req.headers['companyid'], params, 'find');

        if (response) {
            return res.status(200).json({
                status: true,
                data: response
            });
        } else {
            return res.status(404).json({
                status: false,
            });
        }

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while get the task global filter",
            error: error 
        });
    }
}

/**
 * This endpoint is used to save task advance filter
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.saveFilter = async (req, res) => {
    try {
        const companyId = req.body.companyId;

        const params = {
            type: SCHEMA_TYPE.GLOBALFILTER,
            data: { ...req.body }
        };

        const response = await MongoDbCrudOpration(companyId, params, "save");

        if(response) {
            return res.status(200).json({
                status: true,
                data: response
            });
        } else {
            return res.status(404).json({
                status: false,
            });
        }

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while saving the task global filter",
            error: error 
        });
    }
}

/**
 * This endpoint is used to update global advance filter
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.updateFilter = async (req, res) => {
    try {
        const params = {
            type: SCHEMA_TYPE.GLOBALFILTER,
            data: req.body
        }

        const response = await MongoDbCrudOpration(req.headers['companyid'], params, 'findOneAndUpdate');

        if(response) {
            return res.status(200).json({
                status: true,
            });
        } else {
            return res.status(404).json({
                status: false,
            });
        }

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while update the project global filter",
            error: error 
        });
    }
}

/**
 * This endpoint is used to delete task advance filter
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.deleteFilter = async (req, res) => {
    try {
        const { id, cid } = req.params;
        const params = {
            type: SCHEMA_TYPE.GLOBALFILTER,
            data: [
                {
                    _id: new mongoose.Types.ObjectId(id)
                }
            ]
        }

        const response = await MongoDbCrudOpration(cid, params, "deleteOne")

        if (response) {
            return res.status(200).json({
                status: true,
            });
        } else {
            return res.status(404).json({
                status: false,
            });
        }

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while delete the project global filter",
            error: error 
        });
    }
}

/**
 * This endpoint is used to filter tasks in global advance filter
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.searchTasks = async (req, res) => {
    try {
        const {
            searchText = '',
            filterQuery = {},
            pids = [],
            skip = 0,
            batchSize = 20,
            sortBy = 'createdAt',
            userId,
            roleType,
        } = req.body;

        // Parse inputs and prepare default values
        const searchStr = searchText.toString();
        const parsedFilterQuery = typeof filterQuery === 'string' ? JSON.parse(filterQuery) : filterQuery;
        let additionalFilter = parsedFilterQuery && Object.keys(parsedFilterQuery).length ? { ...parsedFilterQuery } : {};
        const projectIds = Array.isArray(pids) ? pids : pids.split(',').map(id => id.trim());
        const convertedProjectIds = projectIds.map(id => new mongoose.Types.ObjectId(id));
        const skipValue = parseInt(skip);
        const batchSizeValue = parseInt(batchSize);

        additionalFilter = replaceObjectKey(additionalFilter, ["objId", "dbDate"]);

        // Current user ID as string (because AssigneeUserId is stored as string) 
        const currentUserId = userId ? userId.toString() : null;

        // Aggregation stages
        const searchResultMatch = {
            $match: {
                $and: [
                    { ...additionalFilter },
                    { ProjectID: { $in: convertedProjectIds } },
                    { deletedStatusKey: { $in: [undefined, 0] } },
                    ...(searchStr ? [{ TaskName: { $regex: searchStr, $options: "i" } }] : []),
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
                        $project: {
                            name: 1,
                            folderId: 1,
                            private: 1,
                            AssigneeUserId: 1,
                        },
                    },
                ],
            },
        }

        const sprintUnwind = { $unwind: '$sprintArray' };

        let sprintPrivacyFilter = null;
        if (roleType !== 1 && roleType !== 2) {
            sprintPrivacyFilter = currentUserId
                ? {
                    $match: {
                        $or: [
                            { 'sprintArray.private': { $ne: true } },
                            { 'sprintArray.AssigneeUserId': currentUserId },
                        ],
                    },
                }
                : {
                    $match: { 'sprintArray.private': { $ne: true } },
                };
        }

        const folderLookup = {
            $lookup: {
                from: 'folders',
                localField: 'folderObjId',
                foreignField: '_id',
                as: 'folderArray',
                pipeline: [
                    {
                        $project: {
                            name: 1,
                        }
                    }
                ]
            }
        }

        const folderUnwind = { $unwind: { path: '$folderArray', preserveNullAndEmptyArrays: true } };

        const sortOption = {
            $sort: {
                [sortBy === 'last_update' ? 'updatedAt' : 'createdAt']: -1,
                _id: 1
            }
        };

        const skipStage = { $skip: skipValue };

        const limitStage = { $limit: batchSizeValue };

        const aggregationPipeline = [
            searchResultMatch,
            sprintLookup,
            sprintUnwind,
            ...(sprintPrivacyFilter ? [sprintPrivacyFilter] : []),
            folderLookup,
            folderUnwind,
            sortOption,
            skipStage,
            limitStage
        ];

        const params = {
            type: SCHEMA_TYPE.TASKS,
            data: [aggregationPipeline],
        };

        const response = await MongoDbCrudOpration(req.headers['companyid'], params, 'aggregate');

        return res.status(200).json({
            status: true,
            data: response?.length ? response : [],
            message: response?.length ? undefined : 'No tasks found',
        });

    } catch (error) {
        logger.error(`Error in searchTasks hook: ${error}`)
        return res.status(500).json({
            status: false,
            message: 'Internal Server Error',
            error: error.message,
        });
    }
}

/**
 * This endpoint is used to filter projects in global advance filter
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.searchProjects = async (req, res) => {
    try {
        const {
            searchText,
            sortBy,
            skipValue,
            batchSizeValue,
            filterQuery = {},
            publicQuery,
            privateQuery,
        } = req.body;

        const searchStr = searchText.toString();
        const parsedFilterQuery = typeof filterQuery === 'string' ? JSON.parse(filterQuery) : filterQuery;
        const additionalFilter = parsedFilterQuery && Object.keys(parsedFilterQuery).length ? { ...parsedFilterQuery } : {};

        const searchResultMatch = {
            $match: {
                $and: [
                    { ...additionalFilter },
                    { statusType: { $ne: "close" } },
                    { deletedStatusKey: { $in: [undefined, 0] } },
                    ...(searchStr
                        ? [{ ProjectName: { $regex: searchStr, $options: "i" } }]
                        : []),
                    {
                        $or: [publicQuery, privateQuery]
                    }
                ]
            }
        }

        const sortOption = {
            $sort: {
                [sortBy === 'last_update' ? 'updatedAt' : 'createdAt']: -1,
                _id: 1,
            }
        };

        const skipStage = { $skip: skipValue };

        const limitStage = { $limit: batchSizeValue };

        const aggregationPipeline = [searchResultMatch, sortOption, skipStage, limitStage];

        const params = {
            type: SCHEMA_TYPE.PROJECTS,
            data: [aggregationPipeline],
        };

        const response = await MongoDbCrudOpration(req.headers['companyid'], params, 'aggregate');
        if (response && response.length) {
            return res.status(200).json({ status: true, data: response });
        } else {
            return res.status(404).json({ status: false, message: 'No projects found' });
        }

    } catch (error) {
        logger.error(`Error in searchProjects hook: ${error}`)
        return res.status(500).json({
            status: false,
            message: 'Internal Server Error',
            error: error.message,
        });
    }
}

/**
 * This endpoint is used to filter all type of uploaded attachments in global advance filter
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.searchFiles = async (req, res) => {
    try {
        const { 
            sortBy = "last_update", 
            skipValue = 0, 
            batchSizeValue = 10, 
            filterQuery = {}, 
            pids = [] 
        } = req.body;

        // Parse and validate filters
        const parsedFilterQuery = typeof filterQuery === 'string' ? JSON.parse(filterQuery) : filterQuery;
        const convertedProjectIds = pids.map(id => new mongoose.Types.ObjectId(id));

        let additionalFilter = [];
        if(Object.keys(parsedFilterQuery).length) {
            const extractIds = parsedFilterQuery["$and"][0]["_id"]["objId"]["$in"];
            additionalFilter = extractIds.map(id => new mongoose.Types.ObjectId(id));
        }

        // Construct additional filter
        const defaultFilterParams = Object.keys(parsedFilterQuery).length
            ? { $and: [{ _id: { $in: additionalFilter } }] }
            : { $and: [{ _id: { $in: convertedProjectIds } }] };

        // Aggregation pipeline
        const query = [
            { $match: defaultFilterParams },
            {
                $lookup: {
                    from: "tasks",
                    localField: "_id",
                    foreignField: "ProjectID",
                    as: "taskData",
                    pipeline: [{ $match: { $expr: { $ne: ["$attachments", []] } } }],
                },
            },
            {
                $lookup: {
                    from: "comments",
                    localField: "_id",
                    foreignField: "projectId",
                    as: "commentData",
                    pipeline: [{ $match: { type: { $nin: ["text", "link"] } } }],
                },
            },
            {
                $lookup: {
                    from: "sprints",
                    localField: "taskData.sprintId",
                    foreignField: "_id",
                    as: "sprintData",
                },
            },
            {
                $lookup: {
                    from: "folders",
                    localField: "taskData.folderObjId",
                    foreignField: "_id",
                    as: "folderData",
                },
            },
            {
                $project: {
                    taskDetail: {
                        $map: {
                            input: { $range: [0, { $size: "$taskData" }] },
                            as: "index",
                            in: {
                                ...extractTaskData(),
                                sprintData: filterData("$sprintData", "$taskData.sprintId"),
                                folderData: filterData("$folderData", "$taskData.folderObjId"),
                            },
                        },
                    },
                    commmentDetail: {
                        $map: {
                            input: { $range: [0, { $size: "$commentData" }] },
                            as: "index",
                            in: extractCommentData(),
                        },
                    },
                    attachments: 1,
                    updatedAt: 1,
                    createdAt: 1,
                    _id: 1,
                },
            },
            {
                $group: {
                    _id: "$_id",
                    attachments: { $first: "$attachments" },
                    taskAttachment: { $first: "$taskDetail" },
                    commentsAttachment: { $first: "$commmentDetail" },
                    updatedAt: { $first: "$updatedAt" },
                    createdAt: { $first: "$createdAt" },
                },
            },
            {
                $sort: { [sortBy === "last_update" ? "updatedAt" : "createdAt"]: -1, _id: 1 },
            },
            { $skip: skipValue },
            { $limit: batchSizeValue },
        ];

        // Execute the query
        const params = { type: SCHEMA_TYPE.PROJECTS, data: [query] };
        const response = await MongoDbCrudOpration(req.headers['companyid'], params, 'aggregate');

        if (response?.length) {
            return res.status(200).json({ status: true, data: response });
        } else {
            return res.status(404).json({ status: false, message: 'No projects found' });
        }
    } catch (error) {
        logger.error(`Error in searchFiles hook: ${error}`);
        return res.status(500).json({
            status: false,
            message: 'Internal Server Error',
            error: error.message,
        });
    }
}


exports.searchLinks = async (req, res) => {
    try {
        const {
            sortBy = "last_update",
            skipValue = 0,
            batchSizeValue = 10,
            filterQuery = {},
            pids = []
        } = req.body;

        // Parse and validate filters
        const parsedFilterQuery = typeof filterQuery === 'string' ? JSON.parse(filterQuery) : filterQuery;
        const convertedProjectIds = pids.map(id => new mongoose.Types.ObjectId(id));


        let additionalFilter = [];
        if (Object.keys(parsedFilterQuery).length) {
            const extractIds = parsedFilterQuery["$and"][0]["_id"]["objId"]["$in"];
            additionalFilter = extractIds.map(id => new mongoose.Types.ObjectId(id));
        }

        // Construct additional filter
        const defaultFilterParams = Object.keys(parsedFilterQuery).length
            ? { $and: [{ _id: { $in: additionalFilter } }] }
            : { $and: [{ _id: { $in: convertedProjectIds } }] };

        // Aggregation pipeline
        const query = [
            {
                $match: { ...defaultFilterParams }
            },
            {
                $lookup: {
                    from: "tasks",
                    localField: "_id",
                    foreignField: "ProjectID",
                    pipeline: [
                        {
                            $match: {
                                rawDescription: { $exists: true, $ne: null }
                            }
                        },
                        {
                            $project: {
                                rawDescription: 1,
                                sprintArray: 1,
                                sprintId: 1,
                                ProjectID: 1,
                                _id: 1
                            }
                        }
                    ],
                    as: "taskData",
                }
            },
            {
                $lookup: {
                    from: "comments",
                    localField: "_id",
                    foreignField: "projectId",
                    pipeline: [
                        {
                            $match: {
                                type: "link"
                            }
                        },
                        {
                            $project: {
                                message: 1,
                                sprintId: 1,
                                project: 1,
                                projectId: 1,
                                taskId: 1
                            }
                        }
                    ],
                    as: "commentData",
                }
            },
            {
                $group: {
                    _id: "$_id",
                    taskLink: { $first: "$taskData" },
                    description: { $first: "$description" },
                    commentsLink: { $first: '$commentData' },
                    updatedAt: { $first: "$updatedAt" },
                    createdAt: { $first: "$createdAt" }
                }
            },
            {
                $sort: { [sortBy === 'last_update' ? 'updatedAt' : 'createdAt']: -1, _id: 1 },
            },
            { $skip: skipValue },
            { $limit: batchSizeValue }
        ];

        // Execute the query
        const params = { type: SCHEMA_TYPE.PROJECTS, data: [query] };
        const response = await MongoDbCrudOpration(req.headers['companyid'], params, 'aggregate');

        if (response?.length) {
            return res.status(200).json({ status: true, data: response });
        } else {
            return res.status(404).json({ status: false, message: 'No projects found' });
        }
    } catch (error) {
        logger.error(`Error in searchLinks hook: ${error}`);
        return res.status(500).json({
            status: false,
            message: 'Internal Server Error',
            error: error.message,
        });
    }
}
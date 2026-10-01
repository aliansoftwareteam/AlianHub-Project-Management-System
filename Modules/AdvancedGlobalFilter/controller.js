const mongoose = require("mongoose")
const logger = require("../../Config/loggerConfig");
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { replaceObjectKey } = require("../Auth/helper");
const { escapeRegex } = require("../../utils/escapeRegex");
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { sprintIdentities, visibleSprintClause, hiddenSprintIds } = require('../Sprints/helpers/sprintVisibility');
const { idForms } = require('../../utils/mongo-handler/objectIdKeys');
const savedFilters = require("./helpers/savedFilters");
const { keepVisibleProjectIds } = require('../../Config/projectAccess');
const { visibleProjectIds } = require('../Agents/scope');

/* The files and links searches name their projects in the saved filter when there is one, so those ids
 * are kept to the projects the caller can open as the route does for `pids`. */
const visibleObjectIds = async (req, ids) => (await keepVisibleProjectIds(String(req.headers['companyid'] || ''), req.uid, ids))
    .map((id) => new mongoose.Types.ObjectId(id));

/* The files and links searches join a project's tasks and comments, so each join starts by leaving out
 * the private sprints the caller is not on. Owners and admins read past sprint privacy. */
const visibleSprintStages = async (req, projectIds) => {
    const companyId = String(req.headers['companyid'] || '');
    if (isPrivileged(await getRoleType(companyId, req.uid))) return [];
    const hidden = await hiddenSprintIds(companyId, req.uid, projectIds.map(String));
    return hidden.length ? [{ $match: { sprintId: { $nin: idForms(hidden.map(String)) } } }] : [];
};

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

exports.getFilter = savedFilters.listFilters((req) => ({ filter: 'advancedFilter', typeFilter: String(req.params.filterType || '') }));
exports.saveFilter = savedFilters.saveFilter;
exports.updateFilter = savedFilters.updateFilter;
exports.deleteFilter = savedFilters.deleteFilter;

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


        // Aggregation stages
        const searchResultMatch = {
            $match: {
                $and: [
                    { ...additionalFilter },
                    { ProjectID: { $in: convertedProjectIds } },
                    { deletedStatusKey: { $in: [undefined, 0] } },
                    ...(searchStr ? [{ TaskName: { $regex: escapeRegex(searchStr), $options: "i" } }] : []),
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

        /* The caller is read from the session, never from the body: the body's own userId and
         * roleType would let a client name someone else and inherit their private sprints. */
        const companyId = req.headers['companyid'] || '';
        const roleType = await getRoleType(companyId, req.uid);
        let sprintPrivacyFilter = null;
        if (!isPrivileged(roleType)) {
            const identities = req.uid ? await sprintIdentities(companyId, req.uid) : [];
            sprintPrivacyFilter = { $match: visibleSprintClause(identities, 'sprintArray.') };
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

        const response = await MongoDbCrudOpration(companyId, params, 'aggregate');

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
        // The public and private matches come from the request, so they can only narrow what the caller can open.
        const visibleProjects = (await visibleProjectIds(req.headers['companyid'], req.uid)).map((id) => new mongoose.Types.ObjectId(id));

        const searchResultMatch = {
            $match: {
                $and: [
                    { ...additionalFilter },
                    { statusType: { $ne: "close" } },
                    { deletedStatusKey: { $in: [undefined, 0] } },
                    ...(searchStr
                        ? [{ ProjectName: { $regex: escapeRegex(searchStr), $options: "i" } }]
                        : []),
                    {
                        $or: [publicQuery, privateQuery]
                    },
                    { _id: { $in: visibleProjects } }
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
            additionalFilter = await visibleObjectIds(req, parsedFilterQuery["$and"][0]["_id"]["objId"]["$in"]);
        }

        // Construct additional filter
        const defaultFilterParams = Object.keys(parsedFilterQuery).length
            ? { $and: [{ _id: { $in: additionalFilter } }] }
            : { $and: [{ _id: { $in: convertedProjectIds } }] };
        const visibleSprints = await visibleSprintStages(req, defaultFilterParams.$and[0]._id.$in);

        const query = [
            { $match: defaultFilterParams },
            {
                $lookup: {
                    from: "tasks",
                    localField: "_id",
                    foreignField: "ProjectID",
                    as: "taskData",
                    pipeline: [...visibleSprints, { $match: { $expr: { $ne: ["$attachments", []] } } }],
                },
            },
            {
                $lookup: {
                    from: "comments",
                    localField: "_id",
                    foreignField: "projectId",
                    as: "commentData",
                    pipeline: [...visibleSprints, { $match: { type: { $nin: ["text", "link"] } } }],
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
            additionalFilter = await visibleObjectIds(req, parsedFilterQuery["$and"][0]["_id"]["objId"]["$in"]);
        }

        // Construct additional filter
        const defaultFilterParams = Object.keys(parsedFilterQuery).length
            ? { $and: [{ _id: { $in: additionalFilter } }] }
            : { $and: [{ _id: { $in: convertedProjectIds } }] };
        const visibleSprints = await visibleSprintStages(req, defaultFilterParams.$and[0]._id.$in);

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
                        ...visibleSprints,
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
                        ...visibleSprints,
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

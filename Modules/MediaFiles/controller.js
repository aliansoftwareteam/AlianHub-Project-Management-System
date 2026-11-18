const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const { escapeRegex } = require("../../utils/escapeRegex");
const { taskIdMatch } = require("../Comments/helpers/taskIdMatch");
const { commentThreadAccess, refuseThread } = require("../Comments/helpers/threadAccess");
const { CHANNEL_THREAD } = require("../Comments/helpers/conversation");

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const isId = (value) => typeof value === 'string' && OBJECT_ID.test(value);
const oid = (id) => new mongoose.Types.ObjectId(id);

/* The comment thread a media read names: a project's own comments, or those of one task or conversation in a
 * list. Null when an id is not an id, so nothing the request sends reaches the query as an operator. */
const threadOf = (kind, selected) => {
    if (!selected || typeof selected !== 'object') return null;
    if (kind === 'project') return isId(selected._id) ? { projectId: selected._id } : null;
    if (kind !== 'task' && kind !== 'chat') return null;
    const { ProjectID: projectId, sprintId, _id: taskId } = selected;
    if (!isId(projectId) || !isId(sprintId) || !(isId(taskId) || taskId === CHANNEL_THREAD)) return null;
    return { projectId, sprintId, taskId };
};

const threadConditions = ({ projectId, sprintId, taskId }) => (taskId === undefined
    ? [{ projectId: oid(projectId) }, { project: true }]
    : [{ projectId: oid(projectId) }, { project: false }, { sprintId: oid(sprintId) }, { taskId: taskIdMatch(taskId) }]);

/* The conditions that hold a media read to one thread the caller can open, as the comment routes decide it;
 * or null once the refusal is sent. */
const openThreadConditions = async (req, res, kind, selected) => {
    const thread = threadOf(kind, selected);
    if (!thread) {
        res.status(400).json({ error: 'Invalid selectedData' });
        return null;
    }
    const access = await commentThreadAccess(req.headers['companyid'], req.uid, thread);
    if (!access.allowed) {
        refuseThread(res, access);
        return null;
    }
    return [...threadConditions(thread), access.match];
};

exports.getPaginateMediaFiles = async (req, res) => {
    try {
        const {
            handleType,
            selectedData,
            searchValue,
            searchByUserId,
            selectedOrder,
            skip,
            batchSize,
            mediaTypes,
            excludeMediaTypes
        } = req.query;

        if (!handleType) {
            logger.error("No handletype");
            return res.status(400).json({ error: 'Either handleType is required' });
        }

        let parsedSelectedData;
        let parsedMediaTypes;
        try {
            parsedSelectedData = JSON.parse(selectedData);
            parsedMediaTypes = JSON.parse(mediaTypes || excludeMediaTypes);
        } catch (error) {
            logger.error(`Invalid parsedSelectedData or parsedMediaTypes format`);
            return res.status(400).json({ error: 'Invalid selectedData or parsedMediaTypes format' });
        }
        if (!Array.isArray(parsedMediaTypes) || !parsedMediaTypes.every((type) => typeof type === 'string')) {
            return res.status(400).json({ error: 'Invalid selectedData or parsedMediaTypes format' });
        }

        let matchConditions = [];

        if (excludeMediaTypes) {
            matchConditions.push({
                type: { $nin: parsedMediaTypes }
            });
        } else {
            matchConditions.push({
                type: { $in: parsedMediaTypes }
            });
        }

        matchConditions.push({ isDeleted: false });

        if (searchValue) {
            matchConditions.push({
                mediaName: { $regex: escapeRegex(searchValue), $options: 'i' },
            });
        }

        if (searchByUserId) {
            let userIds;
            try {
                userIds = JSON.parse(searchByUserId);
            } catch (error) {
                userIds = null;
            }
            if (!Array.isArray(userIds) || !userIds.every(isId)) return res.status(400).json({ error: 'Invalid searchByUserId format' });
            matchConditions.push({ userId: { $in: userIds } });
        }

        const threadMatch = await openThreadConditions(req, res, handleType, parsedSelectedData);
        if (!threadMatch) return undefined;
        matchConditions.unshift(...threadMatch);

        const pipeline = [
            { $match: { $and: matchConditions } },
            { $sort: { mediaName: selectedOrder === '0' ? 1 : -1, _id: 1 } },
            { $skip: parseInt(skip, 10) || 0 },
            { $limit: parseInt(batchSize, 10) },
        ];

        const results = await MongoDbCrudOpration(req.headers['companyid'], { type: SCHEMA_TYPE.COMMENTS, data: [pipeline] }, 'aggregate');

        res.status(200).json(results);
    } catch (error) {
        logger.error('Error executing getPaginateMediaFiles query:', JSON.stringify(error));
        res.status(400).json({ error: 'Internal Server Error', message: error.message });
    }
};

exports.getMediaFileUsers = async (req, res) => {
    try {
        const { fromWhich, selectedData, searchValue } = req.query;

        if (!fromWhich || !selectedData) {
            logger.error(`Invalid parameters:`);
            return res.status(400).json({ error: 'Invalid parameters' });
        }

        let parsedSelectedData;
        try {
            parsedSelectedData = JSON.parse(selectedData);
        } catch (error) {
            logger.error(`Invalid selectedData format: ${error?.message}`);
            return res.status(400).json({ error: 'Invalid selectedData format' });
        }

        const threadMatch = await openThreadConditions(req, res, fromWhich, parsedSelectedData);
        if (!threadMatch) return undefined;
        const matchConditions = [...threadMatch, { type: { $in: ['audio'] } }, { isDeleted: false }];

        if (searchValue) {
            matchConditions.push({
                mediaOriginalName: { $regex: escapeRegex(searchValue), $options: 'i' },
            });
        }

        const query = [
            {
                $match: {
                    $and: matchConditions,
                },
            },
            {
                $group: {
                    _id: '$userId',
                    count: { $sum: 1 },
                    results: { $push: '$$ROOT' },
                },
            },
        ];

        const results = await MongoDbCrudOpration(
            req.headers['companyid'],
            {
                type: SCHEMA_TYPE.COMMENTS,
                data: [query],
            },
            'aggregate'
        );

        res.status(200).json(results);
    } catch (error) {
        logger.error('Error executing getMediaFileUsers query:', JSON.stringify(error));
        res.status(400).json({ error: 'Internal Server Error' });
    }
};
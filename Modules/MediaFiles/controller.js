const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const { escapeRegex } = require("../../utils/escapeRegex");

exports.getPaginateMediaFiles = async (req, res) => {
    try {
        const {
            handleType,
            selectedData,
            searchValue,
            searchByUserId,
            selectedOrder,
            nPerPage,
            startValue,
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
            const userIds = JSON.parse(searchByUserId);
            if (Array.isArray(userIds)) {
                matchConditions.push({
                    userId: { $in: userIds },
                });
            }
        }

        if (handleType === 'task') {
            matchConditions.unshift(
                { projectId: new mongoose.Types.ObjectId(parsedSelectedData.ProjectID) },
                { project: false },
                { sprintId: new mongoose.Types.ObjectId(parsedSelectedData.sprintId) },
                { taskId: new mongoose.Types.ObjectId(parsedSelectedData._id) }
            );
        } else if (handleType === 'project') {
            matchConditions.unshift(
                { projectId: new mongoose.Types.ObjectId(parsedSelectedData._id) },
                { project: true }
            );
        } else if (handleType === 'chat') {
            matchConditions.unshift(
                { projectId: new mongoose.Types.ObjectId(parsedSelectedData.ProjectID) },
                { project: false },
                { sprintId: new mongoose.Types.ObjectId(parsedSelectedData.sprintId) },
                {
                    taskId: parsedSelectedData._id === 'default'
                        ? 'default'
                        : new mongoose.Types.ObjectId(parsedSelectedData._id)
                }
            );
        }

        let finalQuery = [
            { $match: { $and: matchConditions } },
            {
                $sort: {
                    mediaName: selectedOrder === '0' ? 1 : -1,
                    _id: 1,
                },
            },
            { $skip: parseInt(skip, 10) || 0 },
            { $limit: parseInt(batchSize, 10) }
    
        ];
       
        const queryfinalQuery = [
            finalQuery,
        ];

        const results = await MongoDbCrudOpration(
            req.headers['companyid'],
            {
                type: SCHEMA_TYPE.COMMENTS,
                data: [queryfinalQuery],
            },
            'aggregate'
        );

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

        let matchConditions = [];

        if (fromWhich === 'task') {
            matchConditions = [
                { projectId: new mongoose.Types.ObjectId(parsedSelectedData.ProjectID) },
                { project: false },
                { sprintId: new mongoose.Types.ObjectId(parsedSelectedData.sprintId) },
                { taskId: new mongoose.Types.ObjectId(parsedSelectedData._id) },
                { type: { $in: ['audio'] } },
                { isDeleted: false },
            ];
        } else if (fromWhich === 'project') {
            matchConditions = [
                { projectId: new mongoose.Types.ObjectId(parsedSelectedData._id) },
                { project: true },
                { type: { $in: ['audio'] } },
                { isDeleted: false },
            ];
        } else if (fromWhich === 'chat') {
            matchConditions = [
                { projectId: new mongoose.Types.ObjectId(parsedSelectedData.ProjectID) },
                { project: false },
                { sprintId: new mongoose.Types.ObjectId(parsedSelectedData.sprintId) },
                { taskId: parsedSelectedData._id === 'default'
                    ? 'default'
                    : new mongoose.Types.ObjectId(parsedSelectedData._id) },
                { type: { $in: ['audio'] } },
                { isDeleted: false },
            ];
        } else {
            logger.error('Invalid fromWhich parameter');
            return res.status(400).json({ error: 'Invalid fromWhich parameter' });
        }

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
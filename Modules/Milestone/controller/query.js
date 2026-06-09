const { myCache } = require("../../../Config/config");
const { removeCache } = require("../../../utils/commonFunctions");
const {HandleBothNotification} = require("../../Tasks/helpers/handleNotification");
const logger = require("../../../Config/loggerConfig");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries.js");
const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const hlp = require("../../Tasks/helpers/helper");
const {updateProjectInternal} = require("../../Project/controller/updateProject.js");
const mongoose = require("mongoose")
const { settingsCollectionDocs } = require("../../../Config/collections");

exports.getMilestone = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.headers["companyid"];

        // Validate required parameters
        if (!id || !companyId) {
            const missingParam = !id ? "Id" : "Company ID";
            return res.status(400).json({
                message: `An error occurred while getting the milestone.`,
                error: `${missingParam} is required.`
            });
        }

        const query = {
            type: SCHEMA_TYPE.MILESTONE,
            data: id === "Weekly" ? [{ billingPeriod: id }] : [{ projectId: id }]
        };

        const response = await MongoDbCrudOpration(companyId, query, "findOne");

        return res.status(200).json(response || {});
    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while getting the milestone.",
            error: error.message || error
        });
    }
};

exports.getMilestoneByProject = async (req, res) => {
    try {
        const { pid } = req.params;
        const companyId = req.headers["companyid"];

        if (!pid || !companyId) {
            const missingParam = !pid ? "Id" : "Company ID";
            return res.status(400).json({
                message: `An error occurred while getting the milestone.`,
                error: `${missingParam} is required.`
            });
        }

        const cacheKey = `milestone:${pid}:${companyId}`;
        const value = myCache.get(cacheKey);

        if (value) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(cacheKey)
            });
            return res.status(200).json(JSON.parse(value));
        }

        const query = {
            type: SCHEMA_TYPE.MILESTONE,
            data: [{ projectId: pid }]
        };

        const response = await MongoDbCrudOpration(companyId, query, "find");
        myCache.set( cacheKey, JSON.stringify(response && response.length ? response : []), 604800 );
        return res.status(200).json(response && response.length ? response : []);
    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while getting the milestone.",
            error: error.message || error
        });
    }
};

exports.updateWeeklyRangeMilestone = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        const { action } = req.body;

        if (!companyId) {
            return res.status(400).json({
                message: "An error occurred while getting the milestone.",
                error: "Company ID is required in headers"
            });
        }
        // Validate body keys

        const allowedKeys = ["action","refreshToken"];
        const invalidKeys = Object.keys(req.body).filter((key) => !allowedKeys.includes(key));
        if (invalidKeys.length > 0) {
            return res.status(400).json({
                message: "An error occurred while updating the currency.",
                error: `Invalid keys provided: ${invalidKeys.join(", ")}. Only the following keys are allowed: ${allowedKeys.join(", ")}.`
            });
        }
        
        const query = {
            type: SCHEMA_TYPE.SETTINGS,
            data: [
                {name: SCHEMA_TYPE.HOURLY_MILESTONE_WEEKLY_RANGE},
                {$set: {settings: [action]}}
            ]
        };

        const response = await MongoDbCrudOpration(companyId, query, "updateOne");

        removeCache(`milestoneRange:${companyId}`);
        if (response && Object.keys(response).length) {
            return res.status(200).json(response);
        } else {
            return res.status(200).json({});
        }
    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while getting the milestone.",
            error: error.message || error
        });
    }
}

exports.getMilestoneReport = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        const { cancel, element, endDate, startDate } = req.body;

        if (!companyId) {
            return res.status(400).json({
                message: "Company ID is required in headers",
                error: "Company ID is missing"
            });
        }

        const allowedKeys = ["cancel", "element", "endDate", "startDate","refreshToken"];
        const invalidKeys = Object.keys(req.body).filter(key => !allowedKeys.includes(key));
        if (invalidKeys.length > 0) {
            return res.status(400).json({
                message: "Invalid request parameters",
                error: `Invalid keys: ${invalidKeys.join(", ")}. Allowed keys: ${allowedKeys.join(", ")}`
            });
        }

        if (!startDate || !endDate) {
            return res.status(400).json({
                message: "Missing or invalid parameters",
                error: "startDate, endDate, are required"
            });
        }

        const statusCondition = Array.isArray(cancel)
            ? { statusId: { $in: cancel } }
            : { statusId: { $ne: cancel } };

        const queryConditions = [
            {
                $and: [
                    { statusDate: { $gt: startDate } },
                    { statusDate: { $lt: endDate } },
                    { projectId: { $in: element } },
                    statusCondition
                ]
            },
            {
                $and: [
                    { minRefundDate: { $lt: endDate } },
                    { maxRefundDate: { $gt: startDate } },
                    { projectId: { $in: element } },
                    statusCondition
                ]
            }
        ];

        const mongoQuery = [
            {
                $match: { $or: queryConditions }
            }
        ];

        const queryObj = {
            type: SCHEMA_TYPE.MILESTONE,
            data: [mongoQuery]
        };

        const response = await MongoDbCrudOpration(companyId, queryObj, "aggregate");
        return res.status(200).json(response?.length ? response : []);

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while getting the milestone report.",
            error: error.message || error
        });
    }
};

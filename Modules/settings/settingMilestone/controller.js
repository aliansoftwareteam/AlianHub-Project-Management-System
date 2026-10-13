const { myCache } = require("../../../Config/config");
const { removeCache } = require("../../../utils/commonFunctions");
const { dbCollections,settingsCollectionDocs } = require("../../../Config/collections");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { settingsUpdateProblem, milestoneArrayFiltersProblem, SETTINGS_UPDATES } = require("../settingsDocUpdate");

exports.getMilestoneBillingPeriod = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        if (!companyId) {
            return res.status(400).json({
                message: "An error occurred while getting the billing period.",
                error: "Company ID is required in headers."
            });
        }
        const cacheKey = `milestoneBillingPeriod:${companyId}`;
        const value = myCache.get(cacheKey);

        if (value) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(cacheKey)
            });
            return res.status(200).json(JSON.parse(value));
        }
        // MongoDB query
        const query = {
            type: dbCollections.SETTINGS,
            data: [
                { name: settingsCollectionDocs.HOURLY_MILESTONE_RANGE }
            ]
        };
        
        // Execute query
        const response = await MongoDbCrudOpration(companyId, query, "find");
        myCache.set( cacheKey, JSON.stringify(response && response.length ? response : []), 604800 );
        return res.status(200).json(response);
    } catch (error) {
        console.error("Error getting billing period:", error);
        return res.status(500).json({
            message: "An error occurred while getting the billing period.",
            error: error.message || error
        });
    }
};

exports.updateMilestoneStatus = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        const { key, updateObject, arrayFilters } = req.body;

        // Validate parameters
        if (!companyId) {
            return res.status(400).json({
                message: "An error occurred while getting the billing period.",
                error: "Company ID is required in headers."
            });
        }
        if (!updateObject) {
            return res.status(400).json({
                message: "Update object is required.",
            });
        }
        if (!key) {
            return res.status(400).json({
                message: "Key is required.",
            });
        }

        const problem = settingsUpdateProblem(SETTINGS_UPDATES.milestoneStatus, key, updateObject) || milestoneArrayFiltersProblem(key, arrayFilters);
        if (problem) return res.status(400).json({ status: false, message: problem });

        const queryObject = [
            { name: settingsCollectionDocs.PROJECT_MILESTONE_STATUS },
            { [key]: updateObject }
        ];

        if (arrayFilters && arrayFilters?.length) {
            queryObject.push({ arrayFilters });
        }

        const query = {
            type: dbCollections.SETTINGS,
            data: queryObject
        };

        const response = await MongoDbCrudOpration(companyId, query, "updateOne");
        removeCache(`milestoneStatus:${companyId}`);
        return res.status(200).json(response);
    } catch (error) {
        console.error("Error updating milestone status:", error);
        return res.status(500).json({
            message: "An error occurred while updating the milestone status.",
            error: error.message || error
        });
    }
};

exports.getMilestoneProjectStatus = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        if (!companyId) {
            return res.status(400).json({
                message: "An error occurred while getting the milestone status.",
                error: "Company ID is required in headers."
            });
        }
        const cacheKey = `milestoneStatus:${companyId}`;
        const value = myCache.get(cacheKey);

        if (value) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(cacheKey)
            });
            return res.status(200).json(JSON.parse(value));
        }

        const query = {
            type: dbCollections.SETTINGS,
            data: [
                { name: settingsCollectionDocs.PROJECT_MILESTONE_STATUS }
            ]
        };
        
        const response = await MongoDbCrudOpration(companyId, query, "find");
        myCache.set( cacheKey, JSON.stringify(response && response.length ? response : []), 604800 );
        return res.status(200).json(response);
    } catch (error) {
        console.error("Error getting milestone status:", error);
        return res.status(500).json({
            message: "An error occurred while getting the milestone status.",
            error: error.message || error
        });
    }
};

exports.getMilestoneRange = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        if (!companyId) {
            return res.status(400).json({
                message: "An error occurred while getting the milestone range.",
                error: "Company ID is required in headers."
            });
        }
        const cacheKey = `milestoneRange:${companyId}`;
        const value = myCache.get(cacheKey);

        if (value) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(cacheKey)
            });
            return res.status(200).json(JSON.parse(value));
        }

        const query = {
            type: dbCollections.SETTINGS,
            data: [
                { name: settingsCollectionDocs.HOURLY_MILESTONE_WEEKLY_RANGE }
            ]
        };
        
        const response = await MongoDbCrudOpration(companyId, query, "find");
        myCache.set( cacheKey, JSON.stringify(response && response.length ? response : []), 604800 );
        return res.status(200).json(response);
    } catch (error) {
        console.error("Error getting milestone range:", error);
        return res.status(500).json({
            message: "An error occurred while getting the milestone range.",
            error: error.message || error
        });
    }
};
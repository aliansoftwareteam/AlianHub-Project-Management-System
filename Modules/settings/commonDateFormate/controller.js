const { myCache } = require("../../../Config/config");
const { removeCache } = require("../../../utils/commonFunctions");
const { dbCollections,settingsCollectionDocs } = require("../../../Config/collections");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { settingsUpdateProblem, SETTINGS_UPDATES } = require("../settingsDocUpdate");

exports.getCommonDateFormate = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        if (!companyId) {
            return res.status(400).json({
                message: "An error occurred while getting the common date formate.",
                error: "Company ID is required in headers."
            });
        }
        const cacheKey = `commonDateFormate:${companyId}`;
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
                { name: settingsCollectionDocs.COMMON_DATE_FORMAT }
            ]
        };

        const response = await MongoDbCrudOpration(companyId, query, "find");
        myCache.set( cacheKey, JSON.stringify(response && response.length ? response : []), 604800 );
        return res.status(200).json(response);
    } catch (error) {
        console.error("Error getting common date formate:", error);
        return res.status(500).json({
            message: "An error occurred while getting the common date formate.",
            error: error.message || error
        });
    }
};

exports.updateCommonDateFormate = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        const { key, updateObject } = req.body;

        if (!companyId) {
            return res.status(400).json({
                message: "An error occurred while getting the common date formate.",
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

        const problem = settingsUpdateProblem(SETTINGS_UPDATES.dateFormat, key, updateObject);
        if (problem) return res.status(400).json({ status: false, message: problem });

        const queryObject = [
            { name: settingsCollectionDocs.COMMON_DATE_FORMAT },
            { [key]: updateObject },
            { $set: {updatedAt: new Date()} }
        ];

        const query = {
            type: dbCollections.SETTINGS,
            data: queryObject
        };

        const response = await MongoDbCrudOpration(companyId, query, "updateOne");
        removeCache(`commonDateFormate:${companyId}`);
        return res.status(200).json(response);
    } catch (error) {
        console.error("Error updating common date formate:", error);
        return res.status(500).json({
            message: "An error occurred while updating the common date formate.",
            error: error.message || error
        });
    }
};
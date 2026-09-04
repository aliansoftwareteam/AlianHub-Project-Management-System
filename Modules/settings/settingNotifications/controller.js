const { myCache } = require("../../../Config/config");
const { removeCache } = require("../../../utils/commonFunctions");
const { dbCollections } = require("../../../Config/collections");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const { ensureNotificationDefaults } = require("../../notification/defaults");

exports.updateNotifications = async (req, res) => {
    try {
        const { id,key,valueToUpdate,fieldToUpdate,elementKey,userId } = req.body;
        const companyId = req.headers["companyid"];
        if (!companyId) {
            return res.status(400).json({
                message: "An error occurred while updating the notifications.",
                error: "Company ID is required in headers."
            });
        }
        // Validate parameters
        if (!id || !key || !fieldToUpdate || !elementKey || !userId) {
            return res.status(400).json({
                message: "An error occurred while updating the notifications.",
                error: "Id, Key,FieldToUpdate,ElementKey and UserId are required."
            });
        }

        // Validate body keys
        const allowedKeys = ["id","key","fieldToUpdate","elementKey","valueToUpdate","userId","refreshToken"];
        const invalidKeys = Object.keys(req.body).filter((key) => !allowedKeys.includes(key));
        if (invalidKeys.length > 0) {
            return res.status(400).json({
                message: "An error occurred while updating the notifications.",
                error: `Invalid keys provided: ${invalidKeys.join(", ")}. Only the following keys are allowed: ${allowedKeys.join(", ")}.`
            });
        }

        // MongoDB query
        const query = {
            type: dbCollections.NOTIFICATIONS_SETTINGS,
            data: [
                { _id: new mongoose.Types.ObjectId(id) },
                { $set: { [`${key}.items.$[element].${fieldToUpdate}`]: valueToUpdate } },
                { arrayFilters: [{ "element.key": elementKey }] }
            ]
        };

        // Execute query
        const response = await MongoDbCrudOpration(companyId, query, "updateOne");
        removeCache(`notification:${userId}:${companyId}`);
        return res.status(200).json(response);
    } catch (error) {
        console.error("Error updating notifications:", error);
        return res.status(500).json({
            message: "An error occurred while updating the notifications.",
            error: error.message || error
        });
    }
};

exports.getNotifications = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        const { id } = req.params;
        if (!companyId || !id) {
            return res.status(400).json({
                message: "An error occurred while getting the notifications.",
                error: "Company ID and User Id is required."
            });
        }
        
        const cacheKey = `notification:${id}:${companyId}`;
        const value = myCache.get(cacheKey);

        if (value) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(cacheKey)
            });
            return res.status(200).json(JSON.parse(value));
        }

        const query = {
            type: dbCollections.NOTIFICATIONS_SETTINGS,
            data: [
                {
                    "userId":id
                }
            ]
        };

        const response = (await MongoDbCrudOpration(companyId, query, "findOne")) || (await ensureNotificationDefaults(companyId, id));
        myCache.set( cacheKey, JSON.stringify(response || {}), 604800 );
        return res.status(200).json(response || {});
    } catch (error) {
        console.error("Error getting notifications:", error);
        return res.status(500).json({
            message: "An error occurred while getting the notifications.",
            error: error.message || error
        });
    }
};

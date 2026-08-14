const { myCache } = require("../../../../Config/config");
const { dbCollections, settingsCollectionDocs } = require("../../../../Config/collections");
const { SCHEMA_TYPE } = require("../../../../Config/schemaType");
const { removeCache } = require("../../../../utils/commonFunctions");
const { MongoDbCrudOpration } = require("../../../../utils/mongo-handler/mongoQueries");

/**
 * Updates the task type settings for a company
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.updateTaskTypeSettingTemplate = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        const { taskImage, assignAsSubtask, assignAsTask, isDeleted, isEditable, isAddNewStatus, value, taskCount, name, iconType, iconValue, iconColor } = req.body;

        if (!companyId) {
            return res.status(400).json({
                message: "An error occurred while updating the task type settings.",
                error: "Company ID is required in headers."
            });
        }

        const requiredFields = { taskImage, value, taskCount, name, assignAsSubtask, assignAsTask, isDeleted, isEditable, isAddNewStatus };
        const missingField = Object.keys(requiredFields).find(key => !requiredFields[key] && requiredFields[key] !== false && requiredFields[key] !== 0);
        if (missingField) {
            return res.status(400).json({ message: `${missingField} is required.` });
        }

        const allowedKeys = ["key", "taskImage", "assignAsSubtask", "assignAsTask", "isDeleted", "isEditable", "isAddNewStatus", "value", "taskCount", "name","refreshToken", "iconType", "iconValue", "iconColor"];
        const invalidKeys = Object.keys(req.body).filter(key => !allowedKeys.includes(key));
        if (invalidKeys.length > 0) {
            return res.status(400).json({
                message: "Invalid keys provided in the request.",
                error: `Invalid keys: ${invalidKeys.join(", ")}. Allowed keys: ${allowedKeys.join(", ")}.`
            });
        }

        const currentDate = new Date();
        const updateObject = {
            name,
            taskCount,
            value,
            isAddNewStatus,
            isEditable,
            isDeleted,
            assignAsSubtask,
            assignAsTask,
            taskImage,
            // Icon library fields (task-type icon PRD). Default to the legacy
            // 'upload' kind so anything not sending them renders unchanged.
            iconType: iconType || 'upload',
            iconValue: iconValue || '',
            iconColor: iconColor || null
        };

        const query = {
            type: dbCollections.SETTINGS,
            data: [
                { name: settingsCollectionDocs.TASK_TYPE },
                { $inc: { totalStatus: 1 } },
                { updatedAt: currentDate },
                { new: true }
            ]
        };

        const response = await MongoDbCrudOpration(companyId, query, "findOneAndUpdate");
        if (!response) {
            return res.status(500).json({ message: "Failed to update totalStatus." });
        }

        updateObject.key = response.totalStatus + 1;
        const updateQuery = {
            type: dbCollections.SETTINGS,
            data: [
                { name: settingsCollectionDocs.TASK_TYPE },
                { $push: { settings: { ...updateObject } } },
                { returnDocument: 'after' }
            ]
        };

        const updateResponse = await MongoDbCrudOpration(companyId, updateQuery, "findOneAndUpdate");
        removeCache(`tasktype:${companyId}`,true);
        return res.status(200).json(updateResponse);

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while updating task type settings.",
            error: error.message || error
        });
    }
};

exports.getTaskTypes = async (req,res) => {
    try {
        const mongoObj = {
            type: SCHEMA_TYPE.SETTINGS,
            data: [
                {
                    "name": settingsCollectionDocs.TASK_TYPE
                }
            ]
        };
        const companyId = req.headers['companyid'];

        const taskTypeCache = `tasktype:${companyId}`;
        let taskTypes = myCache.get(taskTypeCache);
        let isFromCache = true;
        if(!taskTypes){
            isFromCache = false;
            taskTypes =  await MongoDbCrudOpration(companyId, mongoObj, 'find');
            myCache.set(taskTypeCache, taskTypes, 604800);
        }

        if (isFromCache) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(taskTypeCache)
            });
        }

        res.status(200).json(taskTypes);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while getting the task type.", error: error.message });
    }
}
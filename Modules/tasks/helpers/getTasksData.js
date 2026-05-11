const { default: mongoose } = require("mongoose");
const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { replaceObjectKey, relapceUndefinedvals } = require("../../Auth/helper");

exports.getTaskByQyery = async(req,res) => {
    try {
        const companyId = req.headers["companyid"];
        const { findQuery, replaceUndefined=false } = req.body;

        if (!findQuery) {
            return res.status(400).json({
                message: "An error occurred while getting the task.",
                error: "Query is required."
            });
        }
        let query;
        if(replaceUndefined) {
            let modeQuery =  relapceUndefinedvals(findQuery);
            query = replaceObjectKey(modeQuery, ["objId","dbDate"]);
        } else {
            query = replaceObjectKey(findQuery, ["objId","dbDate"]);
        }
        const taskQuery = [query];
        const taskObj = {
            type: SCHEMA_TYPE.TASKS,
            data: [taskQuery]
        };
        const response = await MongoDbCrudOpration(companyId, taskObj, 'aggregate');

        return res.status(200).json(response);
    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while getting the task.",
            error: error.message || error
        });
    }
}

exports.getTask = async(req,res) => {
    try {
        const companyId = req.headers["companyid"];
        const { id } = req.params;
        if (!companyId || !id) {
            return res.status(400).json({
                message: "An error occurred while getting the task.",
                error: "Company ID and Task ID is required."
            });
        }

        const query = {
            type: SCHEMA_TYPE.TASKS,
            data: [
                {
                    _id: new mongoose.Types.ObjectId(id)
                }
            ]
        };

        const response = await MongoDbCrudOpration(companyId, query, "findOne");
        return res.status(200).json(response);
    } catch (error) {
        console.error("Error getting task:", error);
        return res.status(500).json({
            message: "An error occurred while getting the task.",
            error: error.message || error
        });
    }
}

exports.updateTask = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        const { firstParameter, secondParameter, key, isConvertFirstParameter, isConvertSecondParameter } = req.body;

        if (!companyId) {
            return res.status(400).json({
                message: "An error occurred while updating the task.",
                error: "Company ID is required."
            });
        }

        const requiredFields = { firstParameter,secondParameter,key };
        const missingField = Object.keys(requiredFields).find(key => !requiredFields[key]);
        if (missingField) {
            return res.status(400).json({ message: `${missingField} is required.` });
        }

        const allowedKeys = ["firstParameter","secondParameter","key","isConvertFirstParameter","isConvertSecondParameter","refreshToken"];
        const invalidKeys = Object.keys(req.body).filter(key => !allowedKeys.includes(key));
        if (invalidKeys.length > 0) {
            return res.status(400).json({
                message: "Invalid keys provided in the request.",
                error: `Invalid keys: ${invalidKeys.join(", ")}. Allowed keys: ${allowedKeys.join(", ")}.`
            });
        }

        const convertParameter = (param, shouldConvert) => shouldConvert ? replaceObjectKey(param, "objId") : param;
        const convertedFirstParameter = convertParameter(firstParameter, isConvertFirstParameter);
        const convertedSecondParameter = convertParameter(secondParameter, isConvertSecondParameter);

        // Query Data
        const query = {
            type: SCHEMA_TYPE.TASKS,
            data: [convertedFirstParameter, convertedSecondParameter]
        };

        const response = await MongoDbCrudOpration(companyId, query, key);

        return res.status(200).json(response);
    } catch (error) {
        console.error("Error updating task:", error);
        return res.status(500).json({
            message: "An error occurred while updating the task.",
            error: error.message || error
        });
    }
};
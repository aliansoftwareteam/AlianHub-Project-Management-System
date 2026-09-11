const { default: mongoose } = require("mongoose");
const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { replaceObjectKey, relapceUndefinedvals } = require("../../Auth/helper");
const { tenantOf, TenantError } = require("../../../Config/tenant");
const { removeCache } = require("../../../utils/commonFunctions.js");
const socketEmitter = require("../../../event/socketEventEmitter");
const logger = require("../../../Config/loggerConfig");
const { QueryRefused, validatePipeline, visibilityStage } = require("./taskQueryGuard");
const { WriteRefused, parseCascade, assertCanCascade, cascadeFilter } = require("./taskWriteGuard");

const refuse = (res, statusCode, statusText, message, extra = {}) => res.status(statusCode).json({ status: false, statusText, message, ...extra });

exports.getTaskByQyery = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const { findQuery, replaceUndefined = false } = req.body || {};
        if (!findQuery) {
            return refuse(res, 400, "Query is required.", "An error occurred while getting the task.");
        }

        const stages = validatePipeline(findQuery);
        const converted = replaceObjectKey(replaceUndefined ? relapceUndefinedvals(stages) : stages, ["objId", "dbDate"]);
        const scope = await visibilityStage(companyId, req.uid);
        const pipeline = scope ? [scope, ...converted] : converted;

        const response = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [pipeline] }, "aggregate");
        return res.status(200).json(response);
    } catch (error) {
        if (error instanceof QueryRefused) {
            return refuse(res, 400, "Query refused", error.message, { stage: error.stage });
        }
        if (error instanceof TenantError) {
            return refuse(res, error.statusCode, "Forbidden", error.message);
        }
        logger.error(`getTaskByQyery error: ${error.message || error}`);
        return refuse(res, 500, "An error occurred while getting the task.", error.message || String(error));
    }
};

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

const ALLOWED_BODY_KEYS = ["firstParameter", "secondParameter", "key", "isConvertFirstParameter", "isConvertSecondParameter", "refreshToken"];
const SOCKET_FIELDS = { _id: 1, ProjectID: 1, sprintId: 1, ParentTaskId: 1, AssigneeUserId: 1 };

exports.updateTask = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const body = req.body || {};

        const missingField = ["firstParameter", "secondParameter", "key"].find((field) => !body[field]);
        if (missingField) {
            return refuse(res, 400, `${missingField} is required.`, "An error occurred while updating the task.");
        }
        const invalidKeys = Object.keys(body).filter((key) => !ALLOWED_BODY_KEYS.includes(key));
        if (invalidKeys.length > 0) {
            return refuse(res, 400, "Invalid keys provided in the request.", `Invalid keys: ${invalidKeys.join(", ")}.`);
        }

        const cascade = parseCascade(body);
        await assertCanCascade(companyId, req.uid, cascade);

        const filter = cascadeFilter(cascade);
        const tasks = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [filter, SOCKET_FIELDS] }, "find");
        const ids = (tasks || []).map((task) => task._id);
        const result = ids.length
            ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ ...filter, _id: { $in: ids } }, { $set: { deletedStatusKey: cascade.to } }] }, "updateMany")
            : { acknowledged: true, matchedCount: 0, modifiedCount: 0 };

        const updatedFields = { deletedStatusKey: cascade.to };
        (tasks || []).forEach((task) => {
            const plain = typeof task.toObject === "function" ? task.toObject() : task;
            socketEmitter.emit("update", { type: "update", data: { ...plain, ...updatedFields }, updatedFields, module: "task" });
        });
        removeCache("UserProjectData:", true);

        return res.status(200).json({ status: true, statusText: "Tasks updated successfully.", data: result });
    } catch (error) {
        if (error instanceof WriteRefused || error instanceof TenantError) {
            return refuse(res, error.statusCode, "Forbidden", error.message);
        }
        logger.error(`updateTask error: ${error.message || error}`);
        return refuse(res, 500, "An error occurred while updating the task.", error.message || String(error));
    }
};

const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { removeCache } = require("../../../utils/commonFunctions.js");
const socketEmitter = require("../../../event/socketEventEmitter");

const SOCKET_FIELDS = { _id: 1, ProjectID: 1, sprintId: 1, ParentTaskId: 1, AssigneeUserId: 1 };

/* The ids are read first so the write touches exactly the tasks each open board is told about. */
const moveTasks = async (companyId, filter, update, updatedFields, { announce = true } = {}) => {
    const tasks = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [filter, SOCKET_FIELDS] }, "find");
    const ids = (tasks || []).map((task) => task._id);
    const result = ids.length
        ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ ...filter, _id: { $in: ids } }, update] }, "updateMany")
        : { acknowledged: true, matchedCount: 0, modifiedCount: 0 };

    if (announce) {
        (tasks || []).forEach((task) => {
            const plain = typeof task.toObject === "function" ? task.toObject() : task;
            socketEmitter.emit("update", { type: "update", data: { ...plain, ...updatedFields }, updatedFields, module: "task", companyId });
        });
    }
    removeCache("UserProjectData:", true);
    return result;
};

module.exports = { moveTasks, SOCKET_FIELDS };

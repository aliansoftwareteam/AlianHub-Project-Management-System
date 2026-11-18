const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../../event/socketEventEmitter');
const extraLists = require('./taskExtraLists');

/* Kept out of taskMongo on purpose: every method there is an action the task routes dispatch by name, and this
 * one has no caller to judge. For lists that go to the trash with their project. A task that lives in
 * `exceptProjectId` keeps its entry, so restoring that project brings it back whole. */
const leaveLists = async ({ companyId, sprintIds, exceptProjectId }) => {
    if (!sprintIds.length) return 0;
    const gone = new Set(sprintIds.map(String));
    const pull = extraLists.pullOfLists([...gone]);
    const held = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS, data: [{ extraLists: { $elemMatch: pull.extraLists } }, '_id ProjectID extraLists'],
    }, 'find');
    let left = 0;
    for (const task of held || []) {
        if (String(task.ProjectID) === String(exceptProjectId)) continue;
        const leftLists = task.extraLists
            .filter((entry) => gone.has(String(entry.sprintId)))
            .map((entry) => ({ projectId: String(entry.projectId), sprintId: String(entry.sprintId) }));
        // eslint-disable-next-line no-await-in-loop
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS, data: [{ _id: task._id }, { $pull: pull }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (!updated) continue;
        socketEmitter.emit('update', { type: 'update', data: updated, updatedFields: { extraLists: updated.extraLists || [] }, module: 'task', companyId, leftLists });
        left += 1;
    }
    return left;
};

module.exports = { leaveLists };

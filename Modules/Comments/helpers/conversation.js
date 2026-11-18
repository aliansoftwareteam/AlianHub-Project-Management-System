const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const isId = (value) => OBJECT_ID.test(String(value || ''));
const asText = (value) => (value === undefined || value === null ? '' : String(value));

const DIRECT = 'direct';
const CHANNEL = 'channel';
const CHANNEL_THREAD = 'default';

const findOne = (companyId, type, id, fields) => MongoDbCrudOpration(companyId, { type, data: [{ _id: new mongoose.Types.ObjectId(String(id)) }, fields] }, 'findOne');

/* The conversation a comment thread is, or null for a task's own thread and a project's comments. A direct message
 * hangs off a task row marked mainChat and the default chat space holds nothing else; a channel is the 'default'
 * thread of a list, in a chat space or, for a list's own channel, in a project. `acrossLists` names a read of that
 * thread in every list of the project at once. */
const conversationOf = async (companyId, { projectId, sprintId, taskId, acrossLists = false } = {}) => {
    if (isId(taskId)) {
        const task = await findOne(companyId, SCHEMA_TYPE.TASKS, taskId, { mainChat: 1 });
        return task && task.mainChat === true ? DIRECT : null;
    }
    const space = isId(projectId) ? await findOne(companyId, SCHEMA_TYPE.MAIN_CHATS, projectId, { default: 1 }) : null;
    if (space) return space.default === true ? DIRECT : CHANNEL;
    return asText(taskId) === CHANNEL_THREAD && (isId(sprintId) || acrossLists) ? CHANNEL : null;
};

module.exports = { DIRECT, CHANNEL, CHANNEL_THREAD, conversationOf };

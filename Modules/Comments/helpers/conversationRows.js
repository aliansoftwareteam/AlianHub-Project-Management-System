const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { agentOf } = require('../../../Config/agentRequest');
const { idForms } = require('../../../utils/mongo-handler/objectIdKeys');
const { conversationsOfOthers } = require('./conversationReaders');
const { keptFromAgent } = require('./agentChatRows');

// The rule of ./conversationReaders for a read that lists comment rows of many threads at once. It goes into the
// query itself, so a page, a count and a "there is more" never tell of a message the caller does not read.

const find = async (companyId, type, filter, fields) => (await MongoDbCrudOpration(companyId, { type, data: [filter, fields] }, 'find')) || [];
const idsOf = (rows) => rows.map((row) => String(row._id));

/* The direct-message space holds conversations and nothing else, so there the person's own are named; a conversation
 * kept anywhere else is named by its own id. */
const keptFromPerson = async (companyId, uid) => {
    const direct = idsOf(await find(companyId, SCHEMA_TYPE.MAIN_CHATS, { default: true }, { _id: 1 }));
    const [own, ofOthers] = (await Promise.all([
        find(companyId, SCHEMA_TYPE.TASKS, { mainChat: true, AssigneeUserId: String(uid), ProjectID: { $in: idForms(direct) } }, { _id: 1 }),
        find(companyId, SCHEMA_TYPE.TASKS, { ...conversationsOfOthers(uid), ProjectID: { $nin: idForms(direct) } }, { _id: 1 }),
    ])).map(idsOf);
    return [
        ...(direct.length ? [{ projectId: { $in: idForms(direct) }, taskId: { $nin: idForms(own) } }] : []),
        ...(ofOthers.length ? [{ taskId: { $in: idForms(ofOthers) } }] : []),
    ];
};

/* The clause for whoever asks: an agent's own rule, or a person's. {} when nothing is kept from them. */
const keptFromCaller = async (companyId, uid) => {
    if (agentOf(uid)) return keptFromAgent(companyId, uid);
    const kept = await keptFromPerson(companyId, uid);
    return kept.length ? { $nor: kept } : {};
};

module.exports = { keptFromCaller };

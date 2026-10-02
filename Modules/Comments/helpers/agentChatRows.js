const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { agentOf } = require('../../../Config/agentRequest');
const { idForms } = require('../../../utils/mongo-handler/objectIdKeys');
const { CHANNEL_THREAD } = require('./conversation');
const { CHAT_THREAD_REPLY } = require('./chatThreads');

// The chat rule of Agents/guard.js for a read that lists rows of many threads at once: a search, an inbox, a list of
// mentions or notices. It goes into the query itself, so a page, a count and a "there is more" never tell an agent
// that a message it is kept from exists.

const find = async (companyId, type, filter, fields) => (await MongoDbCrudOpration(companyId, { type, data: [filter, fields] }, 'find')) || [];
const idsOf = (rows) => rows.map((row) => String(row._id));

/* The clause for rows that name their thread by projectId and taskId, a comment, a mention or a notice: none of a
 * direct message, and none of a channel unless the agent's token was given chat. {} when the request is a person's.
 * A direct message hangs off a task row marked mainChat, which sits in the default chat space; one found anywhere
 * else is named by its own id. `chatMarks` are the clauses by which the collection itself marks a chat row. */
const keptFromAgent = async (companyId, uid, chatMarks = []) => {
    const agent = agentOf(uid);
    if (!agent) return {};
    const spaces = await find(companyId, SCHEMA_TYPE.MAIN_CHATS, {}, { default: 1 });
    const direct = idsOf(spaces.filter((space) => space.default === true));
    const channelSpaces = idsOf(spaces.filter((space) => space.default !== true));
    const elsewhere = idsOf(await find(companyId, SCHEMA_TYPE.TASKS, { mainChat: true, ProjectID: { $nin: idForms(direct) } }, { _id: 1 }));
    return {
        $nor: [
            { projectId: { $in: idForms(direct) } },
            { taskId: { $in: idForms(elsewhere) } },
            ...(agent.chat ? [] : [{ projectId: { $in: idForms(channelSpaces) } }, { taskId: CHANNEL_THREAD }, ...chatMarks]),
        ],
    };
};

/* A mention keeps `mainChat` on a row that came from chat; a notice is of the chat type, or tells of a reply in a chat thread. */
const mentionsKeptFromAgent = (companyId, uid) => keptFromAgent(companyId, uid, [{ mainChat: true }]);
const noticesKeptFromAgent = (companyId, uid) => keptFromAgent(companyId, uid, [{ changeType: CHAT_THREAD_REPLY }, { type: { $regex: '^chat$', $options: 'i' } }]);

/* `match` with the clause beside it, or `match` itself for a person's request. */
const withoutKept = (match, kept) => (Object.keys(kept).length ? { $and: [match, kept] } : match);

module.exports = { keptFromAgent, mentionsKeptFromAgent, noticesKeptFromAgent, withoutKept };

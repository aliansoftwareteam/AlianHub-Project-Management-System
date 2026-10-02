const { agentOf } = require('../../../Config/agentRequest');

// A conversation, a direct message or a private one, is a task row marked mainChat. It is read by the people in it
// alone: an owner or admin who is not in it does not read it, and neither does an agent. The rule is said here for a
// row already read and for a query on task rows; ./conversationRows says it for the rows that name their thread.

const inConversation = (task, uid) => !agentOf(uid) && [].concat(task.AssigneeUserId || []).map(String).includes(String(uid));

/* Matches the conversations the caller does not read. A query keeps them out under $nor, so a caller that spreads
 * the clause into its own filter and then names a project keeps it. */
const conversationsOfOthers = (uid) => ({ mainChat: true, ...(agentOf(uid) ? {} : { AssigneeUserId: { $ne: String(uid) } }) });
const withoutConversationsOfOthers = (uid) => ({ $nor: [conversationsOfOthers(uid)] });

module.exports = { inConversation, conversationsOfOthers, withoutConversationsOfOthers };

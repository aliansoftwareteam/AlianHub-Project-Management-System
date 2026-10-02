const { projectAsked } = require('../../Agents/guard');
const { CHANNEL, conversationOf } = require('./conversation');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const isId = (value) => OBJECT_ID.test(String(value || ''));

/* A write to a comment thread, for the project's rule for agents: `threadOf(req, companyId)` is the thread, and
 * `actions` names the change on a task's thread, on a project's and in a channel. */
const asked = (threadOf, actions) => projectAsked(async (req, body, companyId) => {
    const thread = (await threadOf(req, companyId)) || {};
    if (isId(thread.taskId)) return { action: actions.task, params: { taskId: String(thread.taskId) } };
    const inChannel = (await conversationOf(companyId, thread)) === CHANNEL;
    return { action: inChannel ? actions.channel : actions.project, params: { projectId: String(thread.projectId || '') } };
});

const every = (action) => ({ task: action, project: action, channel: action });

module.exports = { asked, every };

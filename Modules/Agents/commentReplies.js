const tools = require('../Automations/engine/tools');
const logger = require('../../Config/loggerConfig');
const { findComment, isTaskComment } = require('../Comments/helpers/commentThreads');
const { notifyReply } = require('../Comments/helpers/threadNotices');

// An agent's reply in a task's comment thread. It answers a comment on the very task the reply is written on, so it
// reaches no thread its person could not read through that task; a reply to a reply joins the first comment's thread,
// as the web app places it.

const NOT_ON_TASK = 'That comment was not found on this task, or the person cannot read it. Read the task\'s comments again and reply to one of them.';

const sameId = (a, b) => Boolean(a) && String(a).toLowerCase() === String(b || '').toLowerCase();

/* The first comment of the thread `commentId` is in, when that thread is on `taskId`; a refusal otherwise. */
const threadRootOn = async (companyId, taskId, commentId) => {
    const comment = await findComment(companyId, commentId);
    const root = comment && comment.parentId ? await findComment(companyId, comment.parentId) : comment;
    if (!isTaskComment(root) || !sameId(root.taskId, taskId)) throw new tools.DeterministicError(NOT_ON_TASK);
    return root;
};

/* The people of the thread hear of the reply as they would of a person's. A notice that fails leaves the reply written. */
const announceReply = async (companyId, replyId, root, mentionIds) => {
    try {
        const reply = await findComment(companyId, replyId);
        if (reply) await notifyReply(companyId, reply, root, mentionIds || []);
    } catch (error) {
        logger.error(`agent reply notice: ${error.message}`);
    }
};

module.exports = { threadRootOn, announceReply, NOT_ON_TASK };

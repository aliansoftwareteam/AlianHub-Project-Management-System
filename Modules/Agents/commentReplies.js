const tools = require('../Automations/engine/tools');
const logger = require('../../Config/loggerConfig');
const { findComment, findThreadRoot, canHoldThread, isTaskComment } = require('../Comments/helpers/commentThreads');
const { notifyReply } = require('../Comments/helpers/threadNotices');

// An agent's reply in a task's comment thread. It answers a comment on the very task the reply is written on, so it
// reaches no thread its person could not read through that task. The comment is found as the comment route finds it.

const NOT_ON_TASK = 'That comment was not found on this task, or the person cannot read it. Read the task\'s comments again and reply to one of them.';

const sameId = (a, b) => Boolean(a) && String(a).toLowerCase() === String(b || '').toLowerCase();

/* The comment replied to and the first comment of its thread, when that thread is on `taskId`; a refusal otherwise. */
const repliedTo = async (companyId, taskId, commentId) => {
    const comment = await findThreadRoot(companyId, commentId);
    if (!canHoldThread(comment) || !isTaskComment(comment) || !sameId(comment.taskId, taskId)) throw new tools.DeterministicError(NOT_ON_TASK);
    return { comment, rootId: String(comment.parentId || comment._id) };
};

/* The people of the thread hear of the reply as they would of a person's. A notice that fails leaves the reply written. */
const announceReply = async (companyId, replyId, parent, mentionIds) => {
    try {
        const reply = await findComment(companyId, replyId);
        if (reply) await notifyReply(companyId, reply, parent, mentionIds || []);
    } catch (error) {
        logger.error(`agent reply notice: ${error.message}`);
    }
};

module.exports = { repliedTo, announceReply, NOT_ON_TASK };

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { clipKey, isLinkedFile } = require('../../../common-storage/taskFileKeys');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const ID = '([a-f0-9]{24})';
const TASK_FOLDER = new RegExp(`^Project/${ID}/${ID}/${ID}/Comments/([^/]+)$`, 'i');
const CHANNEL_FOLDER = new RegExp(`^Project/${ID}/${ID}/default/Comments/([^/]+)$`, 'i');
const PROJECT_FOLDER = new RegExp(`^Project/${ID}/Comments/([^/]+)$`, 'i');
const NOT_THIS_THREAD = 'A comment can only carry a file stored for its own thread.';

const isId = (value) => OBJECT_ID.test(String(value || ''));
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const named = (pattern, key) => {
    const match = pattern.exec(typeof key === 'string' ? key : '');
    return match && !['.', '..'].includes(match[match.length - 1]) ? match : null;
};

/* A comment names whatever key its writer sent, so it only owns a file stored in its own thread's
 * folder. A task that moved keeps its files where they were, hence the match on the deepest id. */
const isThreadFile = (comment, key) => {
    if (!comment) return false;
    const task = named(TASK_FOLDER, key);
    if (task) return same(comment.taskId, task[3]);
    const channel = named(CHANNEL_FOLDER, key);
    if (channel) return same(comment.sprintId, channel[2]) && !isId(comment.taskId);
    const project = named(PROJECT_FOLDER, key);
    return Boolean(project) && same(comment.projectId, project[1]) && !isId(comment.sprintId) && !isId(comment.taskId);
};

/* The first file of a new direct conversation is uploaded before its thread exists, into the
 * direct-message space's own folder, and the message that carries it is saved in the new thread. */
const isFirstDirectMessageFile = async (companyId, comment, key) => {
    const folder = named(PROJECT_FOLDER, key);
    if (!folder || !same(comment.projectId, folder[1]) || !isId(comment.taskId)) return false;
    const space = await MongoDbCrudOpration(String(companyId), {
        type: SCHEMA_TYPE.MAIN_CHATS,
        data: [{ _id: new mongoose.Types.ObjectId(folder[1]) }, { default: 1 }],
    }, 'findOne');
    return Boolean(space) && space.default === true;
};

/* What a comment may name as its file when it is written: nothing, a link, a file of its own
 * thread, or a clip from the writer's own library. */
const mayCarryMedia = async (companyId, uid, comment, key) => {
    if (key === undefined || key === null || key === '') return true;
    if (typeof key !== 'string') return false;
    if (isLinkedFile(key) || isThreadFile(comment, key)) return true;
    const clip = clipKey(key);
    if (clip) return same(clip.companyId, companyId) && same(clip.userId, uid);
    return isFirstDirectMessageFile(companyId, comment, key);
};

const refuseMedia = (res) => res.status(400).json({ status: false, statusText: NOT_THIS_THREAD, message: NOT_THIS_THREAD });

module.exports = { NOT_THIS_THREAD, isThreadFile, mayCarryMedia, refuseMedia };

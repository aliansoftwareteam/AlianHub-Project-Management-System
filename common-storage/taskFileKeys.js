const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const URL_LIKE = /^[a-z][a-z0-9+.-]*:/i;
/* The segment after Sprint/ is the task id, not the sprint's: the web app names the folder that way. */
const TASK_ATTACHMENT = /^Project\/([a-f0-9]{24})\/Sprint\/([a-f0-9]{24})\/Attachment\/([^/]+)$/i;
const FORM_UPLOAD = /^formAttachment\/([a-f0-9]{24})\/[a-f0-9]{24}\.[a-z0-9]{1,8}$/i;

const asText = (value) => (value === undefined || value === null ? '' : String(value));

/* A file linked from a cloud drive has no key of ours, and a key that is a url is never followed. */
const isLinkedFile = (key) => !asText(key) || URL_LIKE.test(asText(key));

const taskAttachmentKey = (key) => {
    const match = TASK_ATTACHMENT.exec(asText(key));
    if (!match || ['.', '..'].includes(match[3])) return null;
    return { projectId: match[1].toLowerCase(), taskId: match[2].toLowerCase() };
};

const formUploadKey = (key) => {
    const match = FORM_UPLOAD.exec(asText(key));
    return match ? { formId: match[1].toLowerCase() } : null;
};

/* A form task's origin names the submission that filed it, and the submission names its form.
 * The task body can carry an origin of its own, so a submission that recorded another task names none. */
const formOf = async (companyId, task) => {
    const ref = asText(task && task.origin && task.origin.ref);
    if (!OBJECT_ID.test(ref)) return '';
    const submission = await MongoDbCrudOpration(String(companyId), {
        type: SCHEMA_TYPE.FORM_SUBMISSIONS,
        data: [{ _id: new mongoose.Types.ObjectId(ref) }, 'formId taskId', { lean: true }],
    }, 'findOne');
    if (!submission || !submission.formId) return '';
    if (asText(submission.taskId) && asText(submission.taskId).toLowerCase() !== asText(task._id).toLowerCase()) return '';
    return String(submission.formId).toLowerCase();
};

/* An attachment record is written as the client sends it, so its key only counts as the task's
 * where the app itself stores this task's files: the task's own attachment folder (under whichever
 * project the task was in at upload), or a public form's upload folder on a task that form filed. */
const isTaskOwnKey = async (companyId, task, key) => {
    if (!task) return false;
    const own = taskAttachmentKey(key);
    if (own) return own.taskId === asText(task._id).toLowerCase();
    const form = formUploadKey(key);
    if (!form || !(task.origin && task.origin.kind === 'form')) return false;
    return form.formId === await formOf(companyId, task);
};

const CLIP = /^Clips\/([a-f0-9]{24})\/([a-f0-9]{24})\/[^/]+$/i;
const SPRINT_ATTACHMENT = /^Project\/([a-f0-9]{24})\/Sprint\/([a-f0-9]{24})\/Attachment\/[^/]+$/i;

const clipKey = (key) => {
    const match = CLIP.exec(asText(key));
    return match ? { companyId: match[1].toLowerCase(), userId: match[2].toLowerCase() } : null;
};

/* A voice note recorded before its task existed is filed in the task's sprint folder. */
const inTaskSprintFolder = (task, key) => {
    const match = SPRINT_ATTACHMENT.exec(asText(key));
    return Boolean(match && task) && match[1].toLowerCase() === asText(task.ProjectID).toLowerCase()
        && match[2].toLowerCase() === asText(task.sprintId).toLowerCase();
};

const isTaskStoredFile = async (companyId, task, key) => inTaskSprintFolder(task, key)
    || Boolean(task && task._id && await isTaskOwnKey(companyId, task, key));

/* What a task attachment record may name when it is written: a cloud link, a file stored for
 * the task, or the writer's own clip. */
const mayAttachKey = async (companyId, task, key, actorId) => {
    if (isLinkedFile(key)) return true;
    if (await isTaskStoredFile(companyId, task, key)) return true;
    const clip = clipKey(key);
    return Boolean(clip) && clip.companyId === asText(companyId).toLowerCase() && clip.userId === asText(actorId).toLowerCase();
};

module.exports = {
    mayAttachKey,
    isTaskStoredFile,
    clipKey,
    isLinkedFile,
    taskAttachmentKey,
    formUploadKey,
    formOf,
    isTaskOwnKey,
};

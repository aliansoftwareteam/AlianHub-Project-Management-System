const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { evaluatePermission, isReadable, isWritable } = require('../../Config/permissionGuard');
const { canEditProject, FIELD_PERMISSIONS, DETAILS } = require('../../Config/projectAccess');
const { canSeeSprintById } = require('../Sprints/helpers/sprintVisibility');
const { canUsePage } = require('../Pages/helpers/pageAccess');
const { canChangeComment, canPostToThread } = require('../Comments/helpers/threadWriteAccess');
const { countReported } = require('../../common-storage/storedFileScope');
const { USER_PROFILES_BUCKET, refuseUnverifiedBucket } = require('./bucketAccess');
const logger = require('../../Config/loggerConfig');
const scope = require('./downloadScope');

const REMOVE = 'remove';
const UPLOAD = 'upload';
const NOT_FOUND = 'not_found';
const READ_ONLY = 'read_only';
const READ_ONLY_CODE = 'STORED_FILE_READ_ONLY';
const READ_ONLY_TEXT = 'You do not have permission to change this file';
const INVALID_TEXT = 'Invalid path';

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const FOLDER_NAME = /^[A-Za-z_]{1,24}$/;
const SHAPE_SEGMENTS = 8;
const TASK_TYPE_FOLDER = /^setting\/task_type\//i;
const MAIN_CHAT_TASK = 'default';

const ATTACHMENTS = 'task.task_attachments';
const TASK_CREATE = 'task.task_create';
const CUSTOM_FIELD = 'task.task_custom_field';
const PROJECT_CREATE = 'project.project_create';
const CHANNELS = 'chat.chat_channel';
const DIRECT_MESSAGES = 'chat.one_to_one_chat';
const SPRINT_WRITE = ['project.project_sprint_create', 'project.project_sprint_name_edit', 'project.sprint_type_change'];

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const isId = (value) => OBJECT_ID.test(String(value || ''));
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

const held = (ctx, permission, projectId) => evaluatePermission(ctx.companyId, ctx.uid, permission, projectId ? { projectId: String(projectId) } : {}).catch(() => null);

const holdsAny = async (ctx, permissions, projectId) => {
    for (const permission of permissions) {
        if (isWritable(await held(ctx, permission, projectId))) return true;
    }
    return false;
};

const opens = async (ctx, key) => (await scope.judge({ companyId: ctx.companyId, uid: ctx.uid, key, storage: ctx.storage })).allowed;

/* For a layout these routes never change: whoever may read the file learns that, and nobody else learns it is there. */
const readOnly = async (ctx, _match, key) => ((await opens(ctx, key)) ? READ_ONLY : NOT_FOUND);

const changesTask = async (ctx, task, permission) => {
    if (!(await scope.mayOpenTask(ctx, task))) return NOT_FOUND;
    const value = await held(ctx, permission, task.ProjectID);
    if (!isReadable(value)) return NOT_FOUND;
    return isWritable(value) || READ_ONLY;
};

const opensSprintFolder = async (ctx, projectId, sprintId) => {
    const sprint = await scope.find(ctx, SCHEMA_TYPE.SPRINTS, { _id: oid(sprintId), projectId: oid(projectId) }, '_id');
    return Boolean(sprint)
        && await scope.mayReadProject(ctx, projectId)
        && (await scope.privileged(ctx) || await canSeeSprintById(ctx.companyId, ctx.uid, sprintId));
};

/* A task lists whatever key its writer sent, so a listing alone proves nothing: the caller must also
 * open the sprint the folder names. */
const removesSprintFile = async (ctx, projectId, sprintId, key) => {
    if (!(await opensSprintFolder(ctx, projectId, sprintId))) return NOT_FOUND;
    const visible = await scope.openTaskFilesFilter(ctx);
    const tasks = visible
        ? await scope.find(ctx, SCHEMA_TYPE.TASKS, { 'attachments.url': { $in: scope.keysFor(key) }, ...visible }, 'ProjectID sprintId', 'find') || []
        : [];
    let outcome = NOT_FOUND;
    for (const task of tasks) {
        const change = await changesTask(ctx, task, ATTACHMENTS);
        if (change === true) return true;
        if (change === READ_ONLY) outcome = READ_ONLY;
    }
    return outcome;
};

/* A voice note is recorded before its task exists, so it is stored in the folder of the sprint the task will join. */
const uploadsSprintFile = async (ctx, projectId, sprintId) => {
    if (!(await opensSprintFolder(ctx, projectId, sprintId))) return NOT_FOUND;
    return (await holdsAny(ctx, [ATTACHMENTS, TASK_CREATE], projectId)) || READ_ONLY;
};

const taskAttachment = (withoutTask) => async (ctx, [, projectId, folderId], key) => {
    const task = await scope.taskById(ctx, folderId);
    return task ? changesTask(ctx, task, ATTACHMENTS) : withoutTask(ctx, projectId, folderId, key);
};

const taskFieldFile = async (ctx, [, , taskId]) => {
    const task = await scope.taskById(ctx, taskId);
    return task ? changesTask(ctx, task, CUSTOM_FIELD) : NOT_FOUND;
};

const COMMENT_FOLDERS = Object.freeze({
    task_comment: {
        thread: ([, projectId, sprintId, taskId]) => ({ projectId, sprintId, taskId }),
        owns: (comment, [, , , taskId]) => same(comment.taskId, taskId),
    },
    channel_comment: {
        thread: ([, projectId, channelId]) => ({ projectId, sprintId: channelId, taskId: MAIN_CHAT_TASK }),
        owns: (comment, [, , channelId]) => same(comment.sprintId, channelId) && !isId(comment.taskId),
    },
    project_comment: {
        thread: ([, projectId]) => ({ projectId }),
        owns: (comment, [, projectId]) => same(comment.projectId, projectId) && !isId(comment.sprintId) && !isId(comment.taskId),
    },
});

/* A comment names whatever key its writer sent, so it only owns a file stored in its own thread's
 * folder. A task that moved keeps its files where they were, hence the match on the deepest id. */
const removesCommentFile = (type) => async (ctx, match, key) => {
    if (!(await opens(ctx, key))) return NOT_FOUND;
    const comments = await scope.find(ctx, SCHEMA_TYPE.COMMENTS, { mediaURL: { $in: scope.keysFor(key) } }, 'projectId sprintId taskId userId', 'find') || [];
    let outcome = NOT_FOUND;
    for (const comment of comments.filter((row) => COMMENT_FOLDERS[type].owns(row, match))) {
        if (!(await canChangeComment(ctx.companyId, ctx.uid, comment)).allowed) continue;
        if (same(comment.userId, ctx.uid) || await scope.privileged(ctx)) return true;
        outcome = READ_ONLY;
    }
    return outcome;
};

/* The first file of a new direct conversation is stored before its thread exists, in the direct-message space's own folder. */
const startsDirectMessage = async (ctx, spaceId) => {
    const space = await scope.chatSpace(ctx, spaceId);
    if (!space || space.default !== true) return NOT_FOUND;
    return (await holdsAny(ctx, [DIRECT_MESSAGES])) || READ_ONLY;
};

const uploadsCommentFile = (type) => async (ctx, match, key) => {
    const thread = COMMENT_FOLDERS[type].thread(match);
    if ((await canPostToThread(ctx.companyId, ctx.uid, thread)).allowed && await opens(ctx, key)) return true;
    return type === 'project_comment' ? startsDirectMessage(ctx, thread.projectId) : NOT_FOUND;
};

const editsProject = (anyOf, whenMissing = async () => NOT_FOUND) => async (ctx, [, projectId]) => {
    const decision = await canEditProject(ctx.companyId, ctx.uid, projectId, [anyOf()]);
    if (decision.allowed) return true;
    if (decision.missing) return whenMissing(ctx, projectId);
    return decision.statusCode === 403 ? READ_ONLY : NOT_FOUND;
};

const attachmentKeys = () => FIELD_PERMISSIONS.attachments;
const iconKeys = () => FIELD_PERMISSIONS.projectIcon;
const sprintKeys = () => SPRINT_WRITE;

/* A new project's icon is uploaded under the id the project is about to be saved with. */
const createsProject = async (ctx) => (await holdsAny(ctx, [PROJECT_CREATE])) || READ_ONLY;

const managesChannels = async (ctx, spaceId) => {
    const space = await scope.chatSpace(ctx, spaceId);
    if (!space || space.default === true) return NOT_FOUND;
    return (await holdsAny(ctx, [CHANNELS])) || READ_ONLY;
};

const editsDoc = async (ctx, [, pageId]) => {
    const page = await scope.find(ctx, SCHEMA_TYPE.PAGES, { _id: oid(pageId), deletedStatusKey: 0 }, 'ProjectID visibility createdBy');
    if (!page || !(await canUsePage(ctx.companyId, page, ctx.uid))) return NOT_FOUND;
    return (await canUsePage(ctx.companyId, page, ctx.uid, { edit: true })) || READ_ONLY;
};

const ownFolder = async (ctx, [, companyId, userId], key) => (same(companyId, ctx.companyId) && same(userId, ctx.uid)) || readOnly(ctx, null, key);

const managesCompany = async (ctx) => (await scope.privileged(ctx)) || READ_ONLY;

/* A task type made while setting up a project carries an uploaded image, so that folder is also
 * for whoever may create or set up projects. */
const uploadsCompanyAsset = async (ctx, _match, key) => (await scope.privileged(ctx))
    || (TASK_TYPE_FOLDER.test(key) && await holdsAny(ctx, [PROJECT_CREATE, DETAILS]))
    || READ_ONLY;

const both = (rule) => ({ [REMOVE]: rule, [UPLOAD]: rule });

/* What the record's own write asks, per layout of Modules/storage/downloadScope.js. A layout
 * without an entry here is refused, as a key outside every layout is. */
const RULES = Object.freeze({
    task_attachment: { [REMOVE]: taskAttachment(removesSprintFile), [UPLOAD]: taskAttachment(uploadsSprintFile) },
    task_field_file: both(taskFieldFile),
    task_comment: { [REMOVE]: removesCommentFile('task_comment'), [UPLOAD]: uploadsCommentFile('task_comment') },
    channel_comment: { [REMOVE]: removesCommentFile('channel_comment'), [UPLOAD]: uploadsCommentFile('channel_comment') },
    project_comment: { [REMOVE]: removesCommentFile('project_comment'), [UPLOAD]: uploadsCommentFile('project_comment') },
    project_attachment: both(editsProject(attachmentKeys)),
    project_icon: { [REMOVE]: editsProject(iconKeys), [UPLOAD]: editsProject(iconKeys, createsProject) },
    channel_image: { [REMOVE]: readOnly, [UPLOAD]: editsProject(sprintKeys, managesChannels) },
    clip: both(ownFolder),
    reminder_attachment: both(ownFolder),
    doc_image: { [REMOVE]: editsDoc, [UPLOAD]: readOnly },
    company_asset: { [REMOVE]: managesCompany, [UPLOAD]: uploadsCompanyAsset },
    tracker_screenshot: both(readOnly),
    form_upload: both(readOnly),
});

const refused = (status, type, reason) => ({ allowed: false, status, type, reason });

/* Always enforced: unlike a download, a removal or an overwrite cannot be taken back. */
const judgeChange = async ({ companyId, uid, key, action, storage = process.env.STORAGE_TYPE }) => {
    const path = typeof key === 'string' ? key : '';
    if (!path || !scope.isValidKey(path, storage)) return refused(400, 'invalid', 'invalid_path');
    const found = scope.layoutOf(path);
    if (!found) return refused(404, 'unknown', 'unknown');
    const rule = RULES[found.entry.type];
    if (!rule) return refused(404, found.entry.type, 'no_rule');
    const ctx = { companyId: String(companyId), uid: String(uid || ''), storage };
    const outcome = await rule[action](ctx, found.match, path);
    if (outcome === true) return { allowed: true, type: found.entry.type };
    return outcome === READ_ONLY ? refused(403, found.entry.type, READ_ONLY) : refused(404, found.entry.type, NOT_FOUND);
};

const UNMAPPED = ['unknown', 'no_rule'];

/* Ids and the file name are left out, so the line can say which layout is missing without naming a record. */
const shapeOf = (key) => String(key).split('/').slice(0, SHAPE_SEGMENTS).map((segment, at, all) => {
    if (OBJECT_ID.test(segment)) return '<id>';
    return at < all.length - 1 && FOLDER_NAME.test(segment) ? segment : '<name>';
}).join('/');

const changeVerdict = async (input) => {
    let verdict;
    try {
        verdict = await judgeChange(input);
    } catch (error) {
        logger.error(`stored-file ${input.action} check failed: ${error.message || error}`);
        verdict = refused(404, 'error', 'error');
    }
    if (UNMAPPED.includes(verdict.reason)) {
        const count = countReported(`${input.action}:${verdict.type}:${verdict.reason}`);
        logger.warn(`stored-file ${input.action} refused (layout: ${verdict.type}, reason: ${verdict.reason}, shape: ${shapeOf(input.key)}, refused so far for this layout and reason: ${count})`);
    }
    return verdict;
};

const REFUSAL_TEXT = Object.freeze({ 400: INVALID_TEXT, 403: READ_ONLY_TEXT, 404: scope.REFUSAL_TEXT });
const REFUSAL_CODE = Object.freeze({ 403: READ_ONLY_CODE, 404: scope.REFUSAL_CODE });

const refuse = (res, { status }) => res.status(status).json({
    status: false,
    statusText: REFUSAL_TEXT[status],
    message: REFUSAL_TEXT[status],
    ...(REFUSAL_CODE[status] ? { code: REFUSAL_CODE[status] } : {}),
});

/* Runs after the bucket check, which leaves the verified bucket on the request. The profile bucket
 * keeps its own rule there. */
function requireStoredFileChange(action, pickPath, { storage } = {}) {
    return async (req, res, next) => {
        const bucketId = req.storageBucket;
        if (!bucketId) return refuseUnverifiedBucket(res);
        if (bucketId === USER_PROFILES_BUCKET) return next();
        const verdict = await changeVerdict({ companyId: bucketId, uid: req.uid, key: pickPath(req), action, storage });
        return verdict.allowed ? next() : refuse(res, verdict);
    };
}

/* An upload is checked before multer writes and again once the whole form is parsed; the answer
 * for a path is kept on the request so the second check costs nothing. */
async function uploadScopeRefusal(req, storage) {
    const key = req.body && req.body.path;
    const kept = req.storedFileUpload;
    if (kept && kept.key === key) return kept.refusal;
    const verdict = await changeVerdict({ companyId: req.storageBucket, uid: req.uid, key, action: UPLOAD, storage });
    const refusal = verdict.allowed ? null : { code: verdict.status, statusText: REFUSAL_TEXT[verdict.status] };
    req.storedFileUpload = { key, refusal };
    return refusal;
}

module.exports = {
    REMOVE,
    UPLOAD,
    READ_ONLY_CODE,
    RULES,
    judgeChange,
    changeVerdict,
    requireStoredFileChange,
    uploadScopeRefusal,
};

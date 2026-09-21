const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { getRoleType, isPrivileged, evaluatePermission, isReadable } = require('../../Config/permissionGuard');
const { canReadProject } = require('../../Config/projectAccess');
const { projectAccess } = require('../../Config/contentAccess');
const { canSeeSprintById, hiddenSprintIds } = require('../Sprints/helpers/sprintVisibility');
const { visibleProjectIds } = require('../Agents/scope');
const { resolveSheetScope, scopedTimeMatch, SHEET_PERMISSION } = require('../TimeSheet/helpers/timeScope');
const { isTaskOwnKey } = require('../../common-storage/taskFileKeys');
const { safeRelativePath } = require('../../utils/uploadConfig');
const logger = require('../../Config/loggerConfig');

const ENFORCE = 'enforce';
const REPORT = 'report';
const SERVER_STORAGE = 'server';
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const ID = '([a-f0-9]{24})';
const NAME = '[^/]+';
const THUMBNAIL = '(?:-\\d+x\\d+)?';
const THUMBNAIL_SUFFIX = /-\d+x\d+(\.[^./]+)$/i;
const ATTACHMENTS_PERMISSION = 'task.task_attachments';
const LISTING_LIMIT = 20;
const REFUSAL_CODE = 'STORED_FILE_NOT_AVAILABLE';
const REFUSAL_TEXT = 'File not found';
const NOT_FOUND = 'not_found';
const NO_ACCESS = 'no_access';

const layout = (pattern) => new RegExp(`^${pattern}$`, 'i');
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

const mode = () => (String(process.env.STORAGE_DOWNLOAD_SCOPE || '').trim().toLowerCase() === ENFORCE ? ENFORCE : REPORT);

const find = (ctx, type, query, fields, method = 'findOne') => MongoDbCrudOpration(ctx.companyId, {
    type,
    data: method === 'find' ? [query, fields, { limit: LISTING_LIMIT, lean: true }] : [query, fields, { lean: true }],
}, method);

const baseKey = (key) => key.replace(THUMBNAIL_SUFFIX, '$1');

/* An image is also asked for by a -WxH thumbnail the upload made beside it. */
const keysFor = (key) => [...new Set([key, baseKey(key)])];

const roleOf = async (ctx) => {
    if (ctx.roleType === undefined) ctx.roleType = await getRoleType(ctx.companyId, ctx.uid);
    return ctx.roleType;
};

const privileged = async (ctx) => isPrivileged(await roleOf(ctx));

const mayReadProject = async (ctx, projectId) => OBJECT_ID.test(String(projectId || ''))
    && (await canReadProject(ctx.companyId, ctx.uid, String(projectId))).allowed === true;

/* What the task screen asks before it shows a task: its project, and its sprint when that is private. */
const mayOpenTask = async (ctx, task) => Boolean(task)
    && await mayReadProject(ctx, task.ProjectID)
    && (await privileged(ctx) || await canSeeSprintById(ctx.companyId, ctx.uid, task.sprintId));

const mayReadTaskFilesIn = async (ctx, projectId) => isReadable(await evaluatePermission(ctx.companyId, ctx.uid, ATTACHMENTS_PERMISSION, { projectId: String(projectId) }).catch(() => null));

/* The attachments tab is its own permission, and a project can carry its own rules for it. */
const mayOpenTaskFiles = async (ctx, task) => await mayOpenTask(ctx, task)
    && (await privileged(ctx) || await mayReadTaskFilesIn(ctx, task.ProjectID));

const taskById = (ctx, id) => (OBJECT_ID.test(String(id || ''))
    ? find(ctx, SCHEMA_TYPE.TASKS, { _id: oid(id) }, 'ProjectID sprintId origin AssigneeUserId')
    : Promise.resolve(null));

/* The tasks whose files the caller may open, as a filter, so a key many tasks list is matched
 * against those first; null when there are none. */
const openTaskFilesFilter = async (ctx) => {
    if (await privileged(ctx)) return {};
    const projectIds = [];
    for (const projectId of (await visibleProjectIds(ctx.companyId, ctx.uid)).map(String)) {
        if (OBJECT_ID.test(projectId) && await mayReadTaskFilesIn(ctx, projectId)) projectIds.push(projectId);
    }
    if (!projectIds.length) return null;
    const hidden = (await hiddenSprintIds(ctx.companyId, ctx.uid, projectIds)).map(String).filter((id) => OBJECT_ID.test(id));
    return { ProjectID: { $in: projectIds.map(oid) }, ...(hidden.length ? { sprintId: { $nin: hidden.map(oid) } } : {}) };
};

/* A file that reached a task other than through that task's own folder (a voice note, a clip, a
 * form upload) is read through a task the caller may open that lists it. */
const listedByOpenTask = async (ctx, listing, accepts = async () => true) => {
    const visible = await openTaskFilesFilter(ctx);
    const tasks = visible ? await find(ctx, SCHEMA_TYPE.TASKS, { ...listing, ...visible }, 'ProjectID sprintId origin', 'find') || [] : [];
    for (const task of tasks) {
        if (await accepts(task) && await mayOpenTaskFiles(ctx, task)) return true;
    }
    return (await find(ctx, SCHEMA_TYPE.TASKS, listing, '_id')) ? NO_ACCESS : NOT_FOUND;
};

const listing = (key) => ({ 'attachments.url': { $in: keysFor(key) } });

/* The folder after Sprint/ is the task's. A voice note recorded before its task existed sits in
 * the sprint's folder, and its task may have moved since. */
const taskAttachment = async (ctx, [, , folderId], key) => {
    const task = await taskById(ctx, folderId);
    if (task) return (await mayOpenTaskFiles(ctx, task)) || NO_ACCESS;
    return listedByOpenTask(ctx, listing(key));
};

/* Chat spaces are main_chats rows, not projects: the one-to-one space holds direct messages,
 * the others hold channels every company member may list. */
const chatSpace = (ctx, projectId) => (OBJECT_ID.test(String(projectId || ''))
    ? find(ctx, SCHEMA_TYPE.MAIN_CHATS, { _id: oid(projectId) }, 'default')
    : Promise.resolve(null));

const taskComment = async (ctx, [, , , taskId]) => {
    const task = await taskById(ctx, taskId);
    if (!task) return NOT_FOUND;
    const space = await chatSpace(ctx, task.ProjectID);
    if (space) {
        const participants = (Array.isArray(task.AssigneeUserId) ? task.AssigneeUserId : []).map(String);
        return space.default === true && participants.some((id) => same(id, ctx.uid)) ? true : NO_ACCESS;
    }
    return (await mayOpenTask(ctx, task)) || NO_ACCESS;
};

/* A channel is a sprint of its space; a private one is for the people on it, owners included. */
const channelComment = async (ctx, [, projectId, channelId]) => {
    const space = await chatSpace(ctx, projectId);
    if (space && space.default === true) return NOT_FOUND;
    if (!space && !(await mayReadProject(ctx, projectId))) return NO_ACCESS;
    const channel = await find(ctx, SCHEMA_TYPE.SPRINTS, { _id: oid(channelId), projectId: oid(projectId) }, '_id');
    if (!channel) return NOT_FOUND;
    return (await canSeeSprintById(ctx.companyId, ctx.uid, channelId)) || NO_ACCESS;
};

const inProject = async (ctx, [, projectId]) => (await mayReadProject(ctx, projectId)) || NO_ACCESS;

/* A screenshot is read where its timesheet row is: the tracker screens' own scope. */
const trackerScreenshot = async (ctx, _match, key) => {
    const scope = await resolveSheetScope(ctx.companyId, ctx.uid, Object.values(SHEET_PERMISSION));
    const row = await find(ctx, SCHEMA_TYPE.TIMESHEET, { 'trackShots.image': { $in: keysFor(key) }, ...scopedTimeMatch(scope) }, '_id');
    return Boolean(row) || NO_ACCESS;
};

/* The submissions screen is for the people who may manage the form. */
const formUpload = async (ctx, [, formId], key) => {
    const form = await find(ctx, SCHEMA_TYPE.FORMS, { _id: oid(formId), deletedStatusKey: 0 }, 'ProjectID');
    if (form && (await projectAccess(ctx.companyId, ctx.uid, String(form.ProjectID))).canEdit) return true;
    return listedByOpenTask(ctx, { ...listing(key), 'origin.kind': 'form' }, (task) => isTaskOwnKey(ctx.companyId, task, baseKey(key)));
};

const ownFolder = (ctx, companyId, userId) => same(companyId, ctx.companyId) && same(userId, ctx.uid);

/* A clip is its recorder's until they attach it to a task. */
const clip = async (ctx, [, companyId, userId], key) => {
    if (ownFolder(ctx, companyId, userId)) return true;
    if (!same(companyId, ctx.companyId)) return NO_ACCESS;
    return listedByOpenTask(ctx, { attachments: { $elemMatch: { url: { $in: keysFor(key) }, userId: String(userId) } } });
};

const reminderAttachment = async (ctx, [, companyId, userId]) => ownFolder(ctx, companyId, userId) || NO_ACCESS;

/* Settings images every member sees on every screen; the bucket check already made the caller one. */
const companyAsset = async () => true;

const LAYOUTS = Object.freeze([
    { type: 'task_attachment', pattern: layout(`Project/${ID}/Sprint/${ID}/Attachment/${NAME}`), allows: taskAttachment },
    { type: 'tracker_screenshot', pattern: layout(`Project/${ID}/Sprint/${ID}/TimeLog/${NAME}/${NAME}`), allows: trackerScreenshot },
    { type: 'channel_comment', pattern: layout(`Project/${ID}/${ID}/default/Comments/${NAME}`), allows: channelComment },
    { type: 'task_comment', pattern: layout(`Project/${ID}/${ID}/${ID}/Comments/${NAME}`), allows: taskComment },
    { type: 'project_comment', pattern: layout(`Project/${ID}/Comments/${NAME}`), allows: inProject },
    { type: 'project_attachment', pattern: layout(`Project/${ID}/ProjectAttachment/${NAME}`), allows: inProject },
    { type: 'project_icon', pattern: layout(`Project/${ID}/Settings/ProjectIcon/${NAME}`), allows: inProject },
    { type: 'channel_image', pattern: layout(`chats/${ID}/channelImages/${NAME}`), allows: inProject },
    { type: 'form_upload', pattern: layout(`formAttachment/${ID}/[a-f0-9]{24}${THUMBNAIL}\\.[a-z0-9]{1,8}`), allows: formUpload },
    { type: 'clip', pattern: layout(`Clips/${ID}/${ID}/${NAME}`), allows: clip },
    { type: 'reminder_attachment', pattern: layout(`Reminders/${ID}/${ID}/${NAME}`), allows: reminderAttachment },
    { type: 'company_asset', pattern: layout(`(?:setting/task_type|taskPriorities|companyIcon|ProjectTemplate)/${NAME}`), allows: companyAsset },
]);

const layoutOf = (key) => {
    for (const entry of LAYOUTS) {
        const match = entry.pattern.exec(key);
        if (match) return { entry, match };
    }
    return null;
};

/* On disk every .. is refused, since it could climb out of the bucket folder. An object store key
 * is a plain name, and older uploads kept dots from the file name, so only a whole . or .. segment,
 * an empty one or a leading slash is refused there. */
const isValidKey = (key, storage) => (storage === SERVER_STORAGE
    ? safeRelativePath(key) === key
    : !key.startsWith('/') && key.split('/').every((segment) => segment && segment !== '.' && segment !== '..'));

/* Decides from the key's owning record alone and never looks at storage, so a refusal reads the
 * same whether or not a file sits at the key. */
const judge = async ({ companyId, uid, key, storage = process.env.STORAGE_TYPE }) => {
    const path = typeof key === 'string' ? key : '';
    if (!path || !isValidKey(path, storage)) return { allowed: false, type: 'invalid', reason: 'invalid_path' };
    const found = layoutOf(path);
    if (!found) return { allowed: false, type: 'unknown', reason: 'unknown' };
    const ctx = { companyId: String(companyId), uid: String(uid || '') };
    const outcome = await found.entry.allows(ctx, found.match, path);
    return outcome === true
        ? { allowed: true, type: found.entry.type }
        : { allowed: false, type: found.entry.type, reason: typeof outcome === 'string' ? outcome : NO_ACCESS };
};

const reportedRefusals = new Map();

const countReported = (type, reason) => {
    const label = `${type}:${reason}`;
    const count = (reportedRefusals.get(label) || 0) + 1;
    reportedRefusals.set(label, count);
    return count;
};

const refusalCounts = () => Object.fromEntries(reportedRefusals);

const refuse = (res) => res.status(404).json({ status: false, statusText: REFUSAL_TEXT, message: REFUSAL_TEXT, code: REFUSAL_CODE });

function requireStoredFileRead(pickBucketId, pickPath, { storage, skipBucket = () => false } = {}) {
    return async (req, res, next) => {
        const companyId = String(pickBucketId(req) || '');
        if (skipBucket(companyId)) return next();
        let verdict;
        try {
            verdict = await judge({ companyId, uid: req.uid, key: pickPath(req), storage });
        } catch (error) {
            logger.error(`stored-file download check failed: ${error.message || error}`);
            verdict = { allowed: false, type: 'error', reason: 'error' };
        }
        if (verdict.allowed) return next();
        if (mode() === REPORT) {
            const count = countReported(verdict.type, verdict.reason);
            logger.warn(`stored-file download would be refused (layout: ${verdict.type}, reason: ${verdict.reason}, reported so far for this layout and reason: ${count})`);
            return next();
        }
        return refuse(res);
    };
}

module.exports = {
    REFUSAL_CODE,
    LAYOUTS,
    judge,
    layoutOf,
    mode,
    refusalCounts,
    requireStoredFileRead,
};

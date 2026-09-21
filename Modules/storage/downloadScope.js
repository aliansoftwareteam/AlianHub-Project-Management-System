const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { getRoleType, isPrivileged, evaluatePermission, isReadable } = require('../../Config/permissionGuard');
const { canReadProject } = require('../../Config/projectAccess');
const { projectAccess } = require('../../Config/contentAccess');
const { canSeeSprintById } = require('../Sprints/helpers/sprintVisibility');
const { resolveSheetScope, scopedTimeMatch, SHEET_PERMISSION } = require('../TimeSheet/helpers/timeScope');
const { isTaskOwnKey } = require('../../common-storage/taskFileKeys');
const { safeRelativePath } = require('../../utils/uploadConfig');
const logger = require('../../Config/loggerConfig');

const ENFORCE = 'enforce';
const REPORT = 'report';
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const ID = '([a-f0-9]{24})';
const NAME = '[^/]+';
const THUMBNAIL_SUFFIX = /-\d+x\d+(\.[^./]+)$/i;
const ATTACHMENTS_PERMISSION = 'task.task_attachments';
const LISTING_LIMIT = 20;
const REFUSAL_CODE = 'STORED_FILE_NOT_AVAILABLE';
const REFUSAL_TEXT = 'File not found';

const layout = (pattern) => new RegExp(`^${pattern}$`, 'i');
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

const mode = () => (String(process.env.STORAGE_DOWNLOAD_SCOPE || '').trim().toLowerCase() === REPORT ? REPORT : ENFORCE);

const find = (ctx, type, query, fields, method = 'findOne') => MongoDbCrudOpration(ctx.companyId, {
    type,
    data: method === 'find' ? [query, fields, { limit: LISTING_LIMIT, lean: true }] : [query, fields, { lean: true }],
}, method);

/* An image is also asked for by a -WxH thumbnail the upload made beside it. */
const keysFor = (key) => [...new Set([key, key.replace(THUMBNAIL_SUFFIX, '$1')])];

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

/* The attachments tab is its own permission, and a project can carry its own rules for it. */
const mayOpenTaskFiles = async (ctx, task) => await mayOpenTask(ctx, task)
    && (await privileged(ctx) || isReadable(await evaluatePermission(ctx.companyId, ctx.uid, ATTACHMENTS_PERMISSION, { projectId: String(task.ProjectID) }).catch(() => null)));

const taskById = (ctx, id) => (OBJECT_ID.test(String(id || ''))
    ? find(ctx, SCHEMA_TYPE.TASKS, { _id: oid(id) }, 'ProjectID sprintId origin')
    : Promise.resolve(null));

const recordFor = (task, key) => (Array.isArray(task.attachments) ? task.attachments : [])
    .find((item) => item && keysFor(key).includes(String(item.url))) || null;

/* A file that reached a task other than through its folder (a voice note, a clip, a form upload)
 * is read through a task that lists it and that the rule for its layout accepts as its holder. */
const someTaskListing = async (ctx, key, accepts) => {
    const tasks = await find(ctx, SCHEMA_TYPE.TASKS, { 'attachments.url': { $in: keysFor(key) } }, 'ProjectID sprintId origin attachments', 'find') || [];
    for (const task of tasks) {
        if (await accepts(task, recordFor(task, key)) && await mayOpenTaskFiles(ctx, task)) return true;
    }
    return false;
};

/* The folder after Sprint/ is the task's; a voice note recorded before its task existed sits
 * in its sprint's folder and is read through the task that lists it. */
const taskAttachment = async (ctx, [, , folderId], key) => {
    const task = await taskById(ctx, folderId);
    if (task) return mayOpenTaskFiles(ctx, task);
    return someTaskListing(ctx, key, (listing) => same(listing.sprintId, folderId));
};

const taskComment = async (ctx, [, , , taskId]) => {
    const task = await taskById(ctx, taskId);
    return mayOpenTask(ctx, task);
};

const inProject = async (ctx, [, projectId]) => mayReadProject(ctx, projectId);

/* A screenshot is read where its timesheet row is: the tracker screens' own scope. */
const trackerScreenshot = async (ctx, _match, key) => {
    const scope = await resolveSheetScope(ctx.companyId, ctx.uid, Object.values(SHEET_PERMISSION));
    const row = await find(ctx, SCHEMA_TYPE.TIMESHEET, { 'trackShots.image': { $in: keysFor(key) }, ...scopedTimeMatch(scope) }, '_id');
    return Boolean(row);
};

/* The submissions screen is for the people who may manage the form. */
const formUpload = async (ctx, [, formId], key) => {
    const form = await find(ctx, SCHEMA_TYPE.FORMS, { _id: oid(formId), deletedStatusKey: 0 }, 'ProjectID');
    if (form && (await projectAccess(ctx.companyId, ctx.uid, String(form.ProjectID))).canEdit) return true;
    return someTaskListing(ctx, key, (task) => isTaskOwnKey(ctx.companyId, task, key));
};

const ownFolder = (ctx, companyId, userId) => same(companyId, ctx.companyId) && same(userId, ctx.uid);

/* A clip is its recorder's until they attach it to a task. */
const clip = async (ctx, [, companyId, userId], key) => ownFolder(ctx, companyId, userId)
    || (same(companyId, ctx.companyId) && someTaskListing(ctx, key, (task, record) => Boolean(record) && same(record.userId, userId)));

const reminderAttachment = async (ctx, [, companyId, userId]) => ownFolder(ctx, companyId, userId);

/* Settings images every member sees on every screen; the bucket check already made the caller one. */
const companyAsset = async () => true;

const LAYOUTS = Object.freeze([
    { type: 'task_attachment', pattern: layout(`Project/${ID}/Sprint/${ID}/Attachment/${NAME}`), allows: taskAttachment },
    { type: 'tracker_screenshot', pattern: layout(`Project/${ID}/Sprint/${ID}/TimeLog/${NAME}/${NAME}`), allows: trackerScreenshot },
    { type: 'task_comment', pattern: layout(`Project/${ID}/${ID}/${ID}/Comments/${NAME}`), allows: taskComment },
    { type: 'project_comment', pattern: layout(`Project/${ID}/Comments/${NAME}`), allows: inProject },
    { type: 'project_attachment', pattern: layout(`Project/${ID}/ProjectAttachment/${NAME}`), allows: inProject },
    { type: 'project_icon', pattern: layout(`Project/${ID}/Settings/ProjectIcon/${NAME}`), allows: inProject },
    { type: 'channel_image', pattern: layout(`chats/${ID}/channelImages/${NAME}`), allows: inProject },
    { type: 'form_upload', pattern: layout(`formAttachment/${ID}/[a-f0-9]{24}\\.[a-z0-9]{1,8}`), allows: formUpload },
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

/* Decides from the key's owning record alone and never looks at storage, so a refusal reads the
 * same whether or not a file sits at the key. */
const judge = async ({ companyId, uid, key }) => {
    const path = String(key || '');
    if (!path || safeRelativePath(path) !== path) return { allowed: false, type: 'invalid' };
    const found = layoutOf(path);
    if (!found) return { allowed: false, type: 'unknown' };
    const ctx = { companyId: String(companyId), uid: String(uid || '') };
    const allowed = await found.entry.allows(ctx, found.match, path);
    return { allowed: Boolean(allowed), type: found.entry.type };
};

const reportedRefusals = new Map();

const countReported = (type) => {
    const count = (reportedRefusals.get(type) || 0) + 1;
    reportedRefusals.set(type, count);
    return count;
};

const refusalCounts = () => Object.fromEntries(reportedRefusals);

const refuse = (res) => res.status(404).json({ status: false, statusText: REFUSAL_TEXT, message: REFUSAL_TEXT, code: REFUSAL_CODE });

function requireStoredFileRead(pickBucketId, pickPath, { skipBucket = () => false } = {}) {
    return async (req, res, next) => {
        const companyId = String(pickBucketId(req) || '');
        if (skipBucket(companyId)) return next();
        let verdict;
        try {
            verdict = await judge({ companyId, uid: req.uid, key: pickPath(req) });
        } catch (error) {
            logger.error(`stored-file download check failed: ${error.message || error}`);
            verdict = { allowed: false, type: 'error' };
        }
        if (verdict.allowed) return next();
        if (mode() === REPORT) {
            const count = countReported(verdict.type);
            logger.warn(`stored-file download would be refused (layout: ${verdict.type}, reported so far: ${count})`);
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

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { tenantOf } = require('../../Config/tenant');
const { fail } = require('../../Config/respond');
const logger = require('../../Config/loggerConfig');
const socketEmitter = require('../../event/socketEventEmitter');
const { isCompanyAdmin } = require('../../Config/contentAccess');
const { canReassign, canResolve, assignmentChange, resolutionChange } = require('../Comments/helpers/commentThreads');
const { isDocCommentFile, NOT_THIS_THREAD } = require('../Comments/helpers/commentFileKeys');
const { REACTION_EMOJIS, reactionToggle } = require('../Reactions/helpers/reactionRules');
const { canUsePage } = require('./helpers/pageAccess');
const { isObjectIdString, pageTakesComments } = require('./helpers/pageRules');
const { readMessage, readFile, readBlockId, blockIdsOf, plain, withBlockFallback } = require('./helpers/pageComments');
const { readersOf, docReaders, mentionedReaders, deliverDocCommentNotices, notifyDocCommentAssigned } = require('./helpers/pageCommentNotices');

const MAX_COMMENTS = 500;
const PAGE_NOT_FOUND = 'Page not found.';
const COMMENT_NOT_FOUND = 'Comment not found.';
const DOC_FULL = `This doc has reached its limit of ${MAX_COMMENTS} comments. Delete some to add more.`;

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const callerId = (req) => String((req && req.uid) || '');
const LIVE = { isDeleted: { $ne: true } };

/* Same answer for a doc the caller cannot read as for one that does not exist. */
const readablePage = async (companyId, pageId, uid) => {
    if (!isObjectIdString(pageId)) return null;
    const page = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PAGES,
        data: [{ _id: oid(pageId), deletedStatusKey: 0 }],
    }, 'findOne');
    return pageTakesComments(page) && (await canUsePage(companyId, page, uid)) ? page : null;
};

const findComment = (companyId, page, id) => (isObjectIdString(id)
    ? MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PAGE_COMMENTS, data: [{ _id: oid(id), pageId: oid(page._id), ...LIVE }] }, 'findOne')
    : Promise.resolve(null));

const saveChange = (companyId, comment, change, options = {}) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PAGE_COMMENTS,
    data: [{ _id: oid(comment._id), ...LIVE }, change, { returnDocument: 'after', ...options }],
}, 'findOneAndUpdate');

const liveCount = (companyId, page) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PAGE_COMMENTS,
    data: [{ pageId: oid(page._id), ...LIVE }],
}, 'countDocuments');

const emitChange = (companyId, type, comment) => {
    try {
        socketEmitter.emit(type, { type, data: plain(comment), updatedFields: {}, module: 'pageComments', companyId: String(companyId) });
    } catch (error) {
        logger.error(`ERROR emitting page comment ${type}: ${error.message}`);
    }
};

const notify = (companyId, page, comment, options) => deliverDocCommentNotices(companyId, page, comment, options)
    .catch((error) => logger.error(`ERROR in page comment notices: ${error.message}`));

const failed = (res, name, error) => {
    logger.error(`ERROR in ${name}: ${error.message}`);
    return fail(res, error.message, error.statusCode || 500);
};

/* The request's doc and, when named, one live comment on it; answers the refusal itself and returns null. */
const loadTarget = async (req, res) => {
    const companyId = tenantOf(req);
    const uid = callerId(req);
    const page = await readablePage(companyId, req.params.id, uid);
    if (!page) {
        fail(res, PAGE_NOT_FOUND, 404);
        return null;
    }
    if (req.params.commentId === undefined) return { companyId, uid, page };
    const comment = await findComment(companyId, page, req.params.commentId);
    if (!comment) {
        fail(res, COMMENT_NOT_FOUND, 404);
        return null;
    }
    return { companyId, uid, page, comment };
};

/* GET /api/v2/pages/:id/comments */
exports.listComments = async (req, res) => {
    try {
        const target = await loadTarget(req, res);
        if (!target) return undefined;
        const { companyId, page } = target;
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PAGE_COMMENTS,
            data: [{ pageId: oid(page._id), ...LIVE }, {}, { sort: { createdAt: 1, _id: 1 }, limit: MAX_COMMENTS }],
        }, 'find');
        const blockIds = blockIdsOf(page);
        const data = (rows || []).map((row) => withBlockFallback(row, blockIds));
        return res.send({ status: true, statusText: 'Comments fetched.', data, limit: MAX_COMMENTS, atLimit: data.length >= MAX_COMMENTS });
    } catch (error) {
        return failed(res, 'list page comments', error);
    }
};

/* GET /api/v2/pages/:id/comments/people — the ids a comment on this doc may mention or be assigned to. */
exports.listPeople = async (req, res) => {
    try {
        const target = await loadTarget(req, res);
        if (!target) return undefined;
        return res.send({ status: true, statusText: 'People fetched.', data: await docReaders(target.companyId, target.page) });
    } catch (error) {
        return failed(res, 'list page comment people', error);
    }
};

/* POST /api/v2/pages/:id/comments  body: { message, blockId?, parentId?, mediaURL?, mediaOriginalName?, mediaSize? } */
exports.createComment = async (req, res) => {
    try {
        const body = req.body || {};
        const attached = readFile(body);
        if (attached.reason) return fail(res, attached.reason, 400);
        const text = readMessage(body.message, { optional: Boolean(attached.file) });
        if (text.reason) return fail(res, text.reason, 400);
        const block = readBlockId(body.blockId);
        if (block.reason) return fail(res, block.reason, 400);
        if (body.parentId && !isObjectIdString(body.parentId)) return fail(res, 'parentId must be a valid comment id.', 400);

        const target = await loadTarget(req, res);
        if (!target) return undefined;
        const { companyId, uid, page } = target;
        if (attached.file && !isDocCommentFile(page._id, attached.file.mediaURL)) return fail(res, NOT_THIS_THREAD, 400);
        if ((await liveCount(companyId, page)) >= MAX_COMMENTS) return fail(res, DOC_FULL, 409);

        let thread = null;
        if (body.parentId) {
            const parent = await findComment(companyId, page, body.parentId);
            if (!parent) return fail(res, COMMENT_NOT_FOUND, 404);
            thread = parent.parentId ? await findComment(companyId, page, parent.parentId) : parent;
            if (!thread) return fail(res, COMMENT_NOT_FOUND, 404);
        }

        const mentioned = await mentionedReaders(companyId, page, uid, body.message);
        const doc = {
            pageId: oid(page._id),
            userId: uid,
            message: text.message,
            blockId: thread ? String(thread.blockId || '') : block.blockId,
            mentionIds: mentioned,
            ...(thread ? { parentId: oid(thread._id) } : {}),
            ...(attached.file || {}),
        };
        const created = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PAGE_COMMENTS, data: doc }, 'save');
        emitChange(companyId, 'insert', created);
        await notify(companyId, page, created, { mentioned, thread });
        return res.send({ status: true, statusText: 'Comment added.', data: plain(created) });
    } catch (error) {
        return failed(res, 'create page comment', error);
    }
};

/* PUT /api/v2/pages/:id/comments/:commentId  body: { message } */
exports.updateComment = async (req, res) => {
    try {
        const target = await loadTarget(req, res);
        if (!target) return undefined;
        const { companyId, uid, page, comment } = target;
        if (String(comment.userId) !== uid) return fail(res, 'Only the author can edit this comment.', 403);
        const text = readMessage((req.body || {}).message, { optional: Boolean(comment.mediaURL) });
        if (text.reason) return fail(res, text.reason, 400);

        const mentioned = await mentionedReaders(companyId, page, uid, req.body.message);
        const before = new Set((comment.mentionIds || []).map(String));
        const updated = await saveChange(companyId, comment, { $set: { message: text.message, mentionIds: mentioned, editedAt: new Date() } });
        if (!updated) return fail(res, COMMENT_NOT_FOUND, 404);
        emitChange(companyId, 'update', updated);
        await notify(companyId, page, updated, { mentioned: mentioned.filter((id) => !before.has(id)) });
        return res.send({ status: true, statusText: 'Comment saved.', data: plain(updated) });
    } catch (error) {
        return failed(res, 'update page comment', error);
    }
};

/* PUT /api/v2/pages/:id/comments/:commentId/assign  body: { assigneeId } — empty clears it. */
exports.assignComment = async (req, res) => {
    try {
        const assigneeId = req.body && req.body.assigneeId ? String(req.body.assigneeId) : '';
        const target = await loadTarget(req, res);
        if (!target) return undefined;
        const { companyId, uid, page, comment } = target;
        if (comment.parentId) return fail(res, 'Only a thread can be assigned, not a reply.', 400);
        if (!(await canReassign(companyId, uid, comment))) {
            return fail(res, 'Only the people on this comment or an admin can change who it is assigned to.', 403);
        }
        if (assigneeId && !(await readersOf(companyId, page, [assigneeId])).length) {
            return fail(res, 'Assign the comment to an active member who can read this doc.', 400);
        }
        const updated = await saveChange(companyId, comment, assignmentChange(uid, assigneeId));
        if (!updated) return fail(res, COMMENT_NOT_FOUND, 404);
        emitChange(companyId, 'update', updated);
        if (assigneeId && assigneeId !== String(comment.assigneeId || '')) {
            await notifyDocCommentAssigned(companyId, page, updated, uid)
                .catch((error) => logger.error(`ERROR in page comment assign notice: ${error.message}`));
        }
        return res.send({ status: true, statusText: assigneeId ? 'Comment assigned.' : 'Comment unassigned.', data: plain(updated) });
    } catch (error) {
        return failed(res, 'assign page comment', error);
    }
};

/* PUT /api/v2/pages/:id/comments/:commentId/reaction  body: { emoji } — the caller's own, on or off. */
exports.reactToComment = async (req, res) => {
    try {
        const emoji = req.body && req.body.emoji;
        if (!REACTION_EMOJIS.includes(emoji)) return fail(res, 'Unsupported reaction emoji.', 400);
        const target = await loadTarget(req, res);
        if (!target) return undefined;
        const { companyId, uid, comment } = target;
        const { removes, change } = reactionToggle(comment, emoji, uid);
        // A reaction is not an edit of the comment, so it leaves updatedAt alone, as it does on a task comment.
        const updated = await saveChange(companyId, comment, change, { timestamps: false });
        if (!updated) return fail(res, COMMENT_NOT_FOUND, 404);
        emitChange(companyId, 'update', updated);
        return res.send({ status: true, statusText: removes ? 'Reaction removed.' : 'Reaction added.', data: plain(updated) });
    } catch (error) {
        return failed(res, 'react to page comment', error);
    }
};

/* PUT /api/v2/pages/:id/comments/:commentId/resolve  body: { resolved } — an assigned thread is closed by the
 * people on it, as on a task; one nobody holds by anyone who can comment. */
exports.resolveComment = async (req, res) => {
    try {
        const target = await loadTarget(req, res);
        if (!target) return undefined;
        const { companyId, uid, comment } = target;
        if (comment.parentId) return fail(res, 'Only a thread can be resolved, not a reply.', 400);
        if (comment.assigneeId && !(await canResolve(companyId, uid, comment))) {
            return fail(res, 'Only the assignee, the person who assigned it or an admin can resolve this comment.', 403);
        }
        const resolved = req.body && req.body.resolved !== false && req.body.resolved !== 'false';
        const updated = await saveChange(companyId, comment, resolutionChange(uid, resolved));
        if (!updated) return fail(res, COMMENT_NOT_FOUND, 404);
        emitChange(companyId, 'update', updated);
        return res.send({ status: true, statusText: resolved ? 'Thread resolved.' : 'Thread reopened.', data: plain(updated) });
    } catch (error) {
        return failed(res, 'resolve page comment', error);
    }
};

const removeComment = async (companyId, comment, uid) => {
    const gone = { $set: { isDeleted: true, deletedBy: uid, deletedAt: new Date() } };
    const updated = await saveChange(companyId, comment, gone);
    if (!updated) return null;
    if (!comment.parentId) {
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PAGE_COMMENTS,
            data: [{ parentId: oid(comment._id), ...LIVE }, gone],
        }, 'updateMany');
    }
    emitChange(companyId, 'update', updated);
    return updated;
};

const ONLY_AUTHOR_OR_ADMIN = 'Only the author or an admin can delete this comment.';
const mayDelete = async (companyId, uid, comment) => String(comment.userId) === String(uid) || isCompanyAdmin(companyId, uid);

/* What an undo of a comment made for a person takes back: the live comment on that doc, with its replies, for
 * whom the delete route would let remove it. */
exports.withdrawComment = async (companyId, pageId, commentId, uid) => {
    if (!isObjectIdString(pageId) || !isObjectIdString(commentId)) return null;
    const comment = await findComment(companyId, { _id: pageId }, commentId);
    if (!comment) return null;
    if (!(await mayDelete(companyId, String(uid), comment))) throw Object.assign(new Error(ONLY_AUTHOR_OR_ADMIN), { status: 403, deterministic: true });
    return removeComment(companyId, comment, String(uid));
};

/* DELETE /api/v2/pages/:id/comments/:commentId — the author or an admin; a thread goes with its replies. */
exports.deleteComment = async (req, res) => {
    try {
        const target = await loadTarget(req, res);
        if (!target) return undefined;
        const { companyId, uid, comment } = target;
        if (!(await mayDelete(companyId, uid, comment))) return fail(res, ONLY_AUTHOR_OR_ADMIN, 403);
        if (!(await removeComment(companyId, comment, uid))) return fail(res, COMMENT_NOT_FOUND, 404);
        return res.send({ status: true, statusText: 'Comment deleted.', data: { _id: String(comment._id) } });
    } catch (error) {
        return failed(res, 'delete page comment', error);
    }
};

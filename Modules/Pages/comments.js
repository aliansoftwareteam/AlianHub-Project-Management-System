const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { tenantOf } = require('../../Config/tenant');
const { fail } = require('../../Config/respond');
const logger = require('../../Config/loggerConfig');
const socketEmitter = require('../../event/socketEventEmitter');
const { isCompanyAdmin } = require('../../Config/contentAccess');
const { resolutionChange } = require('../Comments/helpers/commentThreads');
const { canUsePage } = require('./helpers/pageAccess');
const { isObjectIdString, pageTakesComments } = require('./helpers/pageRules');
const { readMessage, readBlockId, blockIdsOf, plain, withBlockFallback } = require('./helpers/pageComments');
const { mentionedReaders, deliverDocCommentNotices } = require('./helpers/pageCommentNotices');

const MAX_COMMENTS = 500;
const PAGE_NOT_FOUND = 'Page not found.';
const COMMENT_NOT_FOUND = 'Comment not found.';

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

const saveChange = (companyId, comment, change) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PAGE_COMMENTS,
    data: [{ _id: oid(comment._id), ...LIVE }, change, { returnDocument: 'after' }],
}, 'findOneAndUpdate');

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
        return res.send({ status: true, statusText: 'Comments fetched.', data: (rows || []).map((row) => withBlockFallback(row, blockIds)) });
    } catch (error) {
        return failed(res, 'list page comments', error);
    }
};

/* POST /api/v2/pages/:id/comments  body: { message, blockId?, parentId? } */
exports.createComment = async (req, res) => {
    try {
        const body = req.body || {};
        const text = readMessage(body.message);
        if (text.reason) return fail(res, text.reason, 400);
        const block = readBlockId(body.blockId);
        if (block.reason) return fail(res, block.reason, 400);
        if (body.parentId && !isObjectIdString(body.parentId)) return fail(res, 'parentId must be a valid comment id.', 400);

        const target = await loadTarget(req, res);
        if (!target) return undefined;
        const { companyId, uid, page } = target;

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
        const text = readMessage((req.body || {}).message);
        if (text.reason) return fail(res, text.reason, 400);
        const target = await loadTarget(req, res);
        if (!target) return undefined;
        const { companyId, uid, page, comment } = target;
        if (String(comment.userId) !== uid) return fail(res, 'Only the author can edit this comment.', 403);

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

/* PUT /api/v2/pages/:id/comments/:commentId/resolve  body: { resolved } */
exports.resolveComment = async (req, res) => {
    try {
        const target = await loadTarget(req, res);
        if (!target) return undefined;
        const { companyId, uid, comment } = target;
        if (comment.parentId) return fail(res, 'Only a thread can be resolved, not a reply.', 400);
        const resolved = req.body && req.body.resolved !== false && req.body.resolved !== 'false';
        const updated = await saveChange(companyId, comment, resolutionChange(uid, resolved));
        if (!updated) return fail(res, COMMENT_NOT_FOUND, 404);
        emitChange(companyId, 'update', updated);
        return res.send({ status: true, statusText: resolved ? 'Thread resolved.' : 'Thread reopened.', data: plain(updated) });
    } catch (error) {
        return failed(res, 'resolve page comment', error);
    }
};

/* DELETE /api/v2/pages/:id/comments/:commentId — the author or an admin; a thread goes with its replies. */
exports.deleteComment = async (req, res) => {
    try {
        const target = await loadTarget(req, res);
        if (!target) return undefined;
        const { companyId, uid, comment } = target;
        if (String(comment.userId) !== uid && !(await isCompanyAdmin(companyId, uid))) {
            return fail(res, 'Only the author or an admin can delete this comment.', 403);
        }
        const gone = { $set: { isDeleted: true, deletedBy: uid, deletedAt: new Date() } };
        const updated = await saveChange(companyId, comment, gone);
        if (!updated) return fail(res, COMMENT_NOT_FOUND, 404);
        if (!comment.parentId) {
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.PAGE_COMMENTS,
                data: [{ parentId: oid(comment._id), ...LIVE }, gone],
            }, 'updateMany');
        }
        emitChange(companyId, 'update', updated);
        return res.send({ status: true, statusText: 'Comment deleted.', data: { _id: String(comment._id) } });
    } catch (error) {
        return failed(res, 'delete page comment', error);
    }
};

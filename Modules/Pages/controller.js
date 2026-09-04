const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { tenantOf } = require("../../Config/tenant");
const { fail } = require("../../Config/respond");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const socketEmitter = require("../../event/socketEventEmitter");
const {
    validatePageInput,
    contentTooLarge,
    htmlToRawText,
    isObjectIdString,
    parseDate,
    nextReviewDate,
    reviewState,
} = require('./helpers/pageRules');
const {
    emptyEditorData,
    contentToEditorData,
    blocksToHtml,
    blocksToRawText,
} = require('./helpers/pageContent');
const { composePage, isAiConfigured } = require('./helpers/pageAi');

const emitPageChange = (type, data) => {
    try {
        socketEmitter.emit(type, { type, data, module: 'pages' });
    } catch (error) {
        logger.error(`ERROR emitting page ${type}: ${error.message}`);
    }
};

// There is no version history. It was removed rather than fixed: it recorded a snapshot
// per save with no way to see what changed. The `pageVersions` collection stays registered
// so the rows already written stay readable — nothing writes to it now.

const LIST_FIELDS = 'title parentPageId ProjectID visibility createdBy linkedTasks updatedBy updatedAt createdAt order '
    + 'isWiki ownerId reviewDate reviewedAt reviewedBy createdByAgent agentName agentStatus rawText';
const EXCERPT_LENGTH = 160;

const toListRow = (page) => {
    const row = page && typeof page.toObject === 'function' ? page.toObject() : { ...(page || {}) };
    row.excerpt = String(row.rawText || '').slice(0, EXCERPT_LENGTH);
    delete row.rawText;
    row.reviewState = reviewState(row);
    return row;
};

const AGENT_STATUSES = ['draft', 'approved'];

/* Fields a page carries besides its body; shared by create and update. Returns the
 * validated patch, or a reason. */
const readPageMeta = ({ visibility, isWiki, ownerId, reviewDate, agentStatus }) => {
    const patch = {};
    if (visibility !== undefined) patch.visibility = String(visibility) === 'private' ? 'private' : 'project';
    if (isWiki !== undefined) patch.isWiki = Boolean(isWiki);
    if (ownerId !== undefined) {
        if (ownerId !== '' && ownerId !== null && !isObjectIdString(ownerId)) {
            return { reason: 'ownerId must be a valid user id when provided.' };
        }
        patch.ownerId = ownerId ? String(ownerId) : '';
    }
    if (reviewDate !== undefined) {
        const date = parseDate(reviewDate);
        if (reviewDate && !date) return { reason: 'reviewDate must be a valid date when provided.' };
        patch.reviewDate = date;
    }
    if (agentStatus !== undefined) {
        if (!AGENT_STATUSES.includes(String(agentStatus))) {
            return { reason: `agentStatus must be one of: ${AGENT_STATUSES.join(', ')}.` };
        }
        patch.agentStatus = String(agentStatus);
    }
    return { patch };
};

/**
 * Who is acting, from the JWT — never from the request body.
 *
 * These handlers used to take `userData` off the body, so the author recorded on a page
 * was whatever the caller typed. `req.uid` is set by the JWT middleware and cannot be
 * chosen by the caller.
 */
const callerId = (req) => String((req && req.uid) || '');

/* POST /api/v2/pages  body: { title, projectId?, parentPageId?, visibility?, linkedTasks?,
 *   contentBlocks?, isWiki?, ownerId?, reviewDate?, createdByAgent?, agentName? } */
exports.createPage = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const {
            title, projectId, parentPageId, visibility, linkedTasks, contentBlocks,
            isWiki, ownerId, reviewDate, createdByAgent, agentName,
        } = req.body || {};
        const check = validatePageInput({ companyId, title, projectId });
        if (!check.valid) {
            return res.send({ status: false, statusText: check.reason });
        }
        // A sub-page. The field and the list projection have carried it since the module
        // was written; only create never accepted it, so every page was a root page.
        if (parentPageId !== undefined && parentPageId !== null && parentPageId !== '' && !isObjectIdString(parentPageId)) {
            return res.send({ status: false, statusText: 'parentPageId must be a valid id when provided.' });
        }
        // Creating a doc from a task links it in the same write. A create-then-update pair
        // would leave an unlinked doc behind whenever the second call failed — one the task
        // it was written for cannot see.
        if (linkedTasks !== undefined && (!Array.isArray(linkedTasks) || !linkedTasks.every((x) => isObjectIdString(x)))) {
            return res.send({ status: false, statusText: 'linkedTasks must be a list of valid task ids.' });
        }
        const meta = readPageMeta({ visibility, isWiki, ownerId, reviewDate });
        if (meta.reason) {
            return res.send({ status: false, statusText: meta.reason });
        }
        const userId = callerId(req);
        const blocks = contentBlocks !== undefined ? contentToEditorData({ blocks: contentBlocks }) : emptyEditorData();
        if (contentBlocks !== undefined && contentTooLarge({ blocks })) {
            return res.send({ status: false, statusText: 'Page content is too large.' });
        }
        const html = blocksToHtml(blocks);
        const doc = {
            title: String(title).trim(),
            content: { html, blocks },
            rawText: htmlToRawText(html),
            createdBy: userId,
            updatedBy: userId,
            deletedStatusKey: 0,
            order: Date.now(),
            linkedTasks: [...new Set((linkedTasks || []).map(String))].map((x) => new mongoose.Types.ObjectId(x)),
            visibility: 'project',
            ...meta.patch,
        };
        if (doc.isWiki) {
            if (!doc.ownerId) doc.ownerId = userId;
            if (!doc.reviewDate) doc.reviewDate = nextReviewDate();
        }
        if (createdByAgent) {
            doc.createdByAgent = true;
            doc.agentName = String(agentName || '').slice(0, 80);
            doc.agentStatus = 'draft';
        }
        if (projectId) {
            doc.ProjectID = new mongoose.Types.ObjectId(projectId);
        }
        if (parentPageId) {
            doc.parentPageId = new mongoose.Types.ObjectId(parentPageId);
        }
        const created = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PAGES, data: doc }, 'save');
        emitPageChange('insert', created);
        return res.send({ status: true, statusText: 'Page created.', data: created });
    } catch (error) {
        logger.error(`ERROR in create page: ${error.message}`);
        return fail(res, error.message, error.statusCode);
    }
};

/* GET /api/v2/pages?projectId=&taskId= — list (no bodies).
 * projectId: that project's docs. taskId: docs linked to that task. Neither: the
 * company-wide docs, i.e. those with no ProjectID. */
exports.listPages = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        if (!companyId) {
            return res.send({ status: false, statusText: 'companyId is required.' });
        }
        const projectId = String(req.query?.projectId || '');
        const taskId = String(req.query?.taskId || '');
        const scope = String(req.query?.scope || '');
        const filter = { deletedStatusKey: scope === 'trash' ? 1 : 0 };

        if (scope === 'trash') {
            // Trash is one flat list across the workspace.
        } else if (taskId) {
            if (!isObjectIdString(taskId)) {
                return res.send({ status: false, statusText: 'taskId must be a valid id.' });
            }
            filter.linkedTasks = new mongoose.Types.ObjectId(taskId);
        } else if (projectId) {
            if (!isObjectIdString(projectId)) {
                return res.send({ status: false, statusText: 'projectId must be a valid id.' });
            }
            filter.ProjectID = new mongoose.Types.ObjectId(projectId);
        } else if (scope === 'all') {
            // Workspace index: every page this caller is allowed to see.
        } else {
            // Company-wide docs only. Omitting the clause entirely returned EVERY doc in
            // the company — including every project's, private ones among them — to any
            // caller who left the parameter off, which is not what the line above promises.
            filter.ProjectID = { $in: [null, undefined] };
        }

        // A private doc belongs to its author alone, so it never appears in anyone else's
        // list — including a task's linked docs, where it would otherwise leak by title.
        const uid = callerId(req);
        filter.$or = [{ visibility: { $ne: 'private' } }, { createdBy: uid }];

        const pages = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PAGES,
            data: [filter, LIST_FIELDS, { sort: { order: 1 } }],
        }, 'find');
        return res.send({ status: true, statusText: 'Pages fetched.', data: (pages || []).map(toListRow) });
    } catch (error) {
        logger.error(`ERROR in list pages: ${error.message}`);
        return fail(res, error.message, error.statusCode);
    }
};

/* GET /api/v2/pages/:id — full page. */
exports.getPage = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const { id } = req.params;
        if (!companyId || !isObjectIdString(id)) {
            return res.send({ status: false, statusText: 'companyId and a valid page id are required.' });
        }
        const page = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PAGES,
            data: [{ _id: new mongoose.Types.ObjectId(id), deletedStatusKey: 0 }],
        }, 'findOne');
        if (!page) {
            return res.send({ status: false, statusText: 'Page not found.' });
        }
        // Same answer for "not yours" as for "does not exist": otherwise the difference
        // tells a caller that a private doc with this id is there.
        if (String(page.visibility || '') === 'private' && String(page.createdBy || '') !== callerId(req)) {
            return res.send({ status: false, statusText: 'Page not found.' });
        }
        const data = typeof page.toObject === 'function' ? page.toObject() : page;
        data.reviewState = reviewState(data);
        return res.send({ status: true, statusText: 'Page fetched.', data });
    } catch (error) {
        logger.error(`ERROR in get page: ${error.message}`);
        return fail(res, error.message, error.statusCode);
    }
};

/* PUT /api/v2/pages/:id  body: { title?, contentHtml?, contentBlocks?, visibility?, linkedTasks?,
 *   isWiki?, ownerId?, reviewDate?, agentStatus? } */
exports.updatePage = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const { id } = req.params;
        const {
            title, contentHtml, contentBlocks, visibility, linkedTasks, isWiki, ownerId, reviewDate, agentStatus,
        } = req.body || {};
        const meta = readPageMeta({ visibility, isWiki, ownerId, reviewDate, agentStatus });
        if (meta.reason) {
            return res.send({ status: false, statusText: meta.reason });
        }
        if (!companyId || !isObjectIdString(id)) {
            return res.send({ status: false, statusText: 'companyId and a valid page id are required.' });
        }
        if (title !== undefined) {
            const check = validatePageInput({ companyId, title });
            if (!check.valid) {
                return res.send({ status: false, statusText: check.reason });
            }
        }
        const nextContent = {};
        if (contentBlocks !== undefined) {
            nextContent.blocks = contentToEditorData({ blocks: contentBlocks });
        }
        if (contentHtml !== undefined) {
            nextContent.html = String(contentHtml);
        }
        if ((nextContent.html || nextContent.blocks) && contentTooLarge({
            html: nextContent.html,
            blocks: nextContent.blocks,
        })) {
            return res.send({ status: false, statusText: 'Page content is too large.' });
        }

        const pageObjId = new mongoose.Types.ObjectId(id);
        const existing = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PAGES,
            data: [{ _id: pageObjId, deletedStatusKey: 0 }],
        }, 'findOne');
        if (!existing) {
            return res.send({ status: false, statusText: 'Page not found.' });
        }

        const userId = callerId(req);
        if (String(existing.visibility || '') === 'private' && String(existing.createdBy || '') !== userId) {
            return res.send({ status: false, statusText: 'Page not found.' });
        }

        const update = { updatedBy: userId };
        if (title !== undefined) update.title = String(title).trim();
        if (contentHtml !== undefined || contentBlocks !== undefined) {
            const merged = { ...(existing.content || {}), ...nextContent };
            if (!merged.html && merged.blocks) merged.html = blocksToHtml(merged.blocks);
            if (!merged.blocks && merged.html) merged.blocks = contentToEditorData({ html: merged.html });
            update.content = merged;
            update.rawText = merged.html ? htmlToRawText(merged.html) : blocksToRawText(merged.blocks);
        }
        Object.assign(update, meta.patch);
        if (update.isWiki && !existing.isWiki) {
            if (!update.ownerId && !existing.ownerId) update.ownerId = userId;
            if (!update.reviewDate && !existing.reviewDate) update.reviewDate = nextReviewDate();
        }
        if (linkedTasks !== undefined) {
            if (!Array.isArray(linkedTasks) || !linkedTasks.every((x) => isObjectIdString(x))) {
                return res.send({ status: false, statusText: 'linkedTasks must be a list of valid task ids.' });
            }
            update.linkedTasks = [...new Set(linkedTasks.map(String))].map((x) => new mongoose.Types.ObjectId(x));
        }
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PAGES,
            data: [{ _id: pageObjId }, { $set: update }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');

        emitPageChange('update', updated);
        return res.send({ status: true, statusText: 'Page saved.', data: updated });
    } catch (error) {
        logger.error(`ERROR in update page: ${error.message}`);
        return fail(res, error.message, error.statusCode);
    }
};

/* A visible, non-deleted page the caller may act on, or null. */
const findVisiblePage = async (companyId, id, uid, deletedStatusKey = 0) => {
    const page = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PAGES,
        data: [{ _id: new mongoose.Types.ObjectId(id), deletedStatusKey }],
    }, 'findOne');
    if (!page) return null;
    if (String(page.visibility || '') === 'private' && String(page.createdBy || '') !== uid) return null;
    return page;
};

const patchPage = async (companyId, id, update) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PAGES,
    data: [{ _id: new mongoose.Types.ObjectId(id) }, { $set: update }, { returnDocument: 'after' }],
}, 'findOneAndUpdate');

/* PUT /api/v2/pages/:id/review  body: { nextReviewDate? } — the owner (or anyone) confirms
 * the page is still right; the next review is three months out unless a date is given. */
exports.markReviewed = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const { id } = req.params;
        if (!companyId || !isObjectIdString(id)) {
            return res.send({ status: false, statusText: 'companyId and a valid page id are required.' });
        }
        const userId = callerId(req);
        const existing = await findVisiblePage(companyId, id, userId);
        if (!existing) {
            return res.send({ status: false, statusText: 'Page not found.' });
        }
        const requested = req.body && req.body.nextReviewDate;
        const next = requested ? parseDate(requested) : nextReviewDate();
        if (!next) {
            return res.send({ status: false, statusText: 'nextReviewDate must be a valid date when provided.' });
        }
        const now = new Date();
        const updated = await patchPage(companyId, id, {
            isWiki: true,
            reviewedAt: now,
            reviewedBy: userId,
            reviewDate: next,
            ownerId: existing.ownerId || userId,
            updatedBy: userId,
        });
        const data = typeof updated.toObject === 'function' ? updated.toObject() : updated;
        data.reviewState = reviewState(data, now);
        emitPageChange('update', data);
        return res.send({ status: true, statusText: 'Page marked as reviewed.', data });
    } catch (error) {
        logger.error(`ERROR in mark page reviewed: ${error.message}`);
        return fail(res, error.message, error.statusCode);
    }
};

/* PUT /api/v2/pages/:id/approve — a person signs off an agent-drafted page. */
exports.approvePage = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const { id } = req.params;
        if (!companyId || !isObjectIdString(id)) {
            return res.send({ status: false, statusText: 'companyId and a valid page id are required.' });
        }
        const userId = callerId(req);
        const existing = await findVisiblePage(companyId, id, userId);
        if (!existing) {
            return res.send({ status: false, statusText: 'Page not found.' });
        }
        if (!existing.createdByAgent) {
            return res.send({ status: false, statusText: 'Only agent-drafted pages need approval.' });
        }
        const updated = await patchPage(companyId, id, { agentStatus: 'approved', approvedBy: userId, updatedBy: userId });
        emitPageChange('update', updated);
        return res.send({ status: true, statusText: 'Page approved.', data: updated });
    } catch (error) {
        logger.error(`ERROR in approve page: ${error.message}`);
        return fail(res, error.message, error.statusCode);
    }
};

/* PUT /api/v2/pages/:id/restore — back out of the trash. Only the page itself: a child
 * restored under a still-deleted parent is re-rooted by the tree, so nothing is lost. */
exports.restorePage = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const { id } = req.params;
        if (!companyId || !isObjectIdString(id)) {
            return res.send({ status: false, statusText: 'companyId and a valid page id are required.' });
        }
        const userId = callerId(req);
        const existing = await findVisiblePage(companyId, id, userId, 1);
        if (!existing) {
            return res.send({ status: false, statusText: 'Page not found in trash.' });
        }
        const updated = await patchPage(companyId, id, { deletedStatusKey: 0, updatedBy: userId });
        emitPageChange('insert', updated);
        return res.send({ status: true, statusText: 'Page restored.', data: updated });
    } catch (error) {
        logger.error(`ERROR in restore page: ${error.message}`);
        return fail(res, error.message, error.statusCode);
    }
};

/* DELETE /api/v2/pages/:id — soft delete, together with everything nested under it. */
exports.deletePage = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const { id } = req.params;
        if (!companyId || !isObjectIdString(id)) {
            return res.send({ status: false, statusText: 'companyId and a valid page id are required.' });
        }

        // The whole subtree, not just this page. Deleting a parent on its own would leave
        // its children pointing at a page that no longer exists — they would either vanish
        // from the tree or reappear at the root, and there would be no way to reach or
        // remove them. Walked breadth-first over the live pages; the set is small.
        const all = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PAGES,
            data: [{ deletedStatusKey: 0 }, '_id parentPageId'],
        }, 'find').catch(() => []);

        const childrenOf = new Map();
        (all || []).forEach((p) => {
            const parent = p.parentPageId ? String(p.parentPageId) : '';
            if (!parent) return;
            if (!childrenOf.has(parent)) childrenOf.set(parent, []);
            childrenOf.get(parent).push(String(p._id));
        });

        const doomed = [];
        const queue = [String(id)];
        // `seen` guards against a cycle in the data — a page that is somehow its own
        // ancestor would otherwise loop here forever.
        const seen = new Set();
        while (queue.length) {
            const next = queue.shift();
            if (seen.has(next)) continue;
            seen.add(next);
            doomed.push(new mongoose.Types.ObjectId(next));
            (childrenOf.get(next) || []).forEach((child) => queue.push(child));
        }

        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PAGES,
            data: [{ _id: { $in: doomed } }, { $set: { deletedStatusKey: 1 } }],
        }, 'updateMany');
        emitPageChange('update', { _id: id, deletedStatusKey: 1, deleted: doomed.length });
        return res.send({ status: true, statusText: 'Page deleted.', data: { deleted: doomed.length } });
    } catch (error) {
        logger.error(`ERROR in delete page: ${error.message}`);
        return fail(res, error.message, error.statusCode);
    }
};

exports.aiStatus = (req, res) => {
    res.send({
        status: true,
        data: { configured: isAiConfigured() },
    });
};

/* POST /api/v2/pages/ai  body: { action, title?, instruction?, currentText?, pageId? } */
exports.composeWithAi = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        if (!companyId) {
            return res.send({ status: false, statusText: 'companyId is required.' });
        }
        const { action, title, instruction, currentText, pageId } = req.body || {};
        let bodyText = String(currentText || '');
        let pageTitle = String(title || '');

        if (pageId && isObjectIdString(pageId) && (!bodyText || !pageTitle)) {
            const page = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.PAGES,
                data: [{ _id: new mongoose.Types.ObjectId(pageId), deletedStatusKey: 0 }],
            }, 'findOne');
            if (page) {
                if (String(page.visibility || '') === 'private' && String(page.createdBy || '') !== callerId(req)) {
                    return res.send({ status: false, statusText: 'Page not found.' });
                }
                if (!pageTitle) pageTitle = page.title || '';
                if (!bodyText) {
                    bodyText = page.rawText || htmlToRawText((page.content && page.content.html) || '')
                        || blocksToRawText(contentToEditorData(page.content));
                }
            }
        }

        const result = await composePage({
            action,
            title: pageTitle,
            instruction,
            currentText: bodyText,
        });
        if (!result.status) {
            return res.send({
                status: false,
                statusText: result.reason || 'Could not compose page content.',
                isNotAi: Boolean(result.isNotAi),
            });
        }
        return res.send({ status: true, statusText: 'Composed.', data: result.data });
    } catch (error) {
        logger.error(`ERROR in page AI compose: ${error.message}`);
        return fail(res, error.message, error.statusCode);
    }
};

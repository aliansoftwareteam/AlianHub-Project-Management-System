const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const socketEmitter = require("../../event/socketEventEmitter");
const { validatePageInput, contentTooLarge, htmlToRawText, isObjectIdString } = require('./helpers/pageRules');
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

// Wiki pages: per-company documentation, optionally scoped to a project.
//
// There is no version history. It was removed rather than fixed: it recorded a snapshot
// per save with no way to see what changed, which made it something to scroll past rather
// than something to use. The `pageVersions` collection and schema are left registered so
// the rows already written stay readable — nothing writes to it now.

/**
 * Who is acting, from the JWT — never from the request body.
 *
 * These handlers used to take `userData` off the body, so the author recorded on a page
 * was whatever the caller typed. `req.uid` is set by the JWT middleware and cannot be
 * chosen by the caller.
 */
const callerId = (req) => String((req && req.uid) || '');

/* POST /api/v2/pages  body: { title, projectId?, parentPageId?, visibility?, linkedTasks? } */
exports.createPage = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { title, projectId, parentPageId, visibility, linkedTasks } = req.body || {};
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
        const userId = callerId(req);
        const emptyBlocks = emptyEditorData();
        const doc = {
            title: String(title).trim(),
            content: { html: '', blocks: emptyBlocks },
            rawText: '',
            createdBy: userId,
            updatedBy: userId,
            deletedStatusKey: 0,
            order: Date.now(),
            linkedTasks: [...new Set((linkedTasks || []).map(String))].map((x) => new mongoose.Types.ObjectId(x)),
            visibility: String(visibility) === 'private' ? 'private' : 'project',
        };
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
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/pages?projectId=&taskId= — list (no bodies).
 * projectId: that project's docs. taskId: docs linked to that task. Neither: the
 * company-wide docs, i.e. those with no ProjectID. */
exports.listPages = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        if (!companyId) {
            return res.send({ status: false, statusText: 'companyId is required.' });
        }
        const projectId = String(req.query?.projectId || '');
        const taskId = String(req.query?.taskId || '');
        const scope = String(req.query?.scope || '');
        const filter = { deletedStatusKey: 0 };

        if (taskId) {
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
            data: [filter, 'title parentPageId ProjectID visibility createdBy linkedTasks updatedBy updatedAt order', { sort: { order: 1 } }],
        }, 'find');
        return res.send({ status: true, statusText: 'Pages fetched.', data: pages || [] });
    } catch (error) {
        logger.error(`ERROR in list pages: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/pages/:id — full page. */
exports.getPage = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
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
        return res.send({ status: true, statusText: 'Page fetched.', data: page });
    } catch (error) {
        logger.error(`ERROR in get page: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* PUT /api/v2/pages/:id  body: { title?, contentHtml?, contentBlocks?, visibility?, linkedTasks? } */
exports.updatePage = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { id } = req.params;
        const { title, contentHtml, contentBlocks, visibility, linkedTasks } = req.body || {};
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
        if (visibility !== undefined) {
            update.visibility = String(visibility) === 'private' ? 'private' : 'project';
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
        return res.send({ status: false, statusText: error.message });
    }
};

/* DELETE /api/v2/pages/:id — soft delete, together with everything nested under it. */
exports.deletePage = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
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
        return res.send({ status: false, statusText: error.message });
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
        const companyId = req.headers['companyid'] || '';
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
        return res.send({ status: false, statusText: error.message });
    }
};

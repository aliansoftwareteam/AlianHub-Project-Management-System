const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const { validatePageInput, contentTooLarge, htmlToRawText, isObjectIdString } = require('./helpers/pageRules');

// Wiki pages: per-company documentation, optionally scoped to a project.
// Single-writer v1 — every save snapshots the previous body into
// pageVersions, and any version can be restored. (Real-time co-editing is
// the documented follow-up; the storage model already supports it.)

/* POST /api/v2/pages  body: { title, projectId?, userData } */
exports.createPage = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { title, projectId, userData } = req.body || {};
        const check = validatePageInput({ companyId, title, projectId });
        if (!check.valid) {
            return res.send({ status: false, statusText: check.reason });
        }
        const userId = userData && (userData.id || userData._id) ? String(userData.id || userData._id) : '';
        const doc = {
            title: String(title).trim(),
            content: { html: '' },
            rawText: '',
            createdBy: userId,
            updatedBy: userId,
            deletedStatusKey: 0,
            order: Date.now(),
        };
        if (projectId) {
            doc.ProjectID = new mongoose.Types.ObjectId(projectId);
        }
        const created = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PAGES, data: doc }, 'save');
        return res.send({ status: true, statusText: 'Page created.', data: created });
    } catch (error) {
        logger.error(`ERROR in create page: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/pages?projectId= — list (no bodies). projectId optional:
 * without it, company-wide pages (no ProjectID) are returned. */
exports.listPages = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        if (!companyId) {
            return res.send({ status: false, statusText: 'companyId is required.' });
        }
        const projectId = String(req.query?.projectId || '');
        const filter = { deletedStatusKey: 0 };
        if (projectId) {
            if (!isObjectIdString(projectId)) {
                return res.send({ status: false, statusText: 'projectId must be a valid id.' });
            }
            filter.ProjectID = new mongoose.Types.ObjectId(projectId);
        }
        const pages = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PAGES,
            data: [filter, 'title parentPageId ProjectID updatedBy updatedAt order', { sort: { order: 1 } }],
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
        return res.send({ status: true, statusText: 'Page fetched.', data: page });
    } catch (error) {
        logger.error(`ERROR in get page: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* PUT /api/v2/pages/:id  body: { title?, contentHtml?, userData } —
 * snapshots the previous body as a version before applying. */
exports.updatePage = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { id } = req.params;
        const { title, contentHtml, userData } = req.body || {};
        if (!companyId || !isObjectIdString(id)) {
            return res.send({ status: false, statusText: 'companyId and a valid page id are required.' });
        }
        if (title !== undefined) {
            const check = validatePageInput({ companyId, title });
            if (!check.valid) {
                return res.send({ status: false, statusText: check.reason });
            }
        }
        if (contentHtml !== undefined && contentTooLarge({ html: contentHtml })) {
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

        // Snapshot the outgoing body (only when the body actually changes).
        if (contentHtml !== undefined) {
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.PAGE_VERSIONS,
                data: {
                    pageId: pageObjId,
                    title: existing.title,
                    content: existing.content || { html: '' },
                    rawText: existing.rawText || '',
                    savedBy: existing.updatedBy || '',
                },
            }, 'save').catch((error) => {
                logger.error(`ERROR in page version snapshot: ${error.message}`);
            });
        }

        const userId = userData && (userData.id || userData._id) ? String(userData.id || userData._id) : '';
        const update = { updatedBy: userId };
        if (title !== undefined) update.title = String(title).trim();
        if (contentHtml !== undefined) {
            update.content = { html: String(contentHtml) };
            update.rawText = htmlToRawText(contentHtml);
        }
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PAGES,
            data: [{ _id: pageObjId }, { $set: update }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        return res.send({ status: true, statusText: 'Page saved.', data: updated });
    } catch (error) {
        logger.error(`ERROR in update page: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* DELETE /api/v2/pages/:id — soft delete. */
exports.deletePage = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { id } = req.params;
        if (!companyId || !isObjectIdString(id)) {
            return res.send({ status: false, statusText: 'companyId and a valid page id are required.' });
        }
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PAGES,
            data: [{ _id: new mongoose.Types.ObjectId(id) }, { $set: { deletedStatusKey: 1 } }],
        }, 'updateOne');
        return res.send({ status: true, statusText: 'Page deleted.' });
    } catch (error) {
        logger.error(`ERROR in delete page: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/pages/:id/versions — newest 20 snapshots (no bodies). */
exports.listVersions = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { id } = req.params;
        if (!companyId || !isObjectIdString(id)) {
            return res.send({ status: false, statusText: 'companyId and a valid page id are required.' });
        }
        const versions = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PAGE_VERSIONS,
            data: [{ pageId: new mongoose.Types.ObjectId(id) }, 'title savedBy createdAt', { sort: { createdAt: -1 }, limit: 20 }],
        }, 'find');
        return res.send({ status: true, statusText: 'Versions fetched.', data: versions || [] });
    } catch (error) {
        logger.error(`ERROR in list page versions: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/pages/:id/restore  body: { versionId, userData } */
exports.restoreVersion = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { id } = req.params;
        const { versionId, userData } = req.body || {};
        if (!companyId || !isObjectIdString(id) || !isObjectIdString(versionId)) {
            return res.send({ status: false, statusText: 'companyId, page id and version id are required.' });
        }
        const version = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PAGE_VERSIONS,
            data: [{ _id: new mongoose.Types.ObjectId(versionId), pageId: new mongoose.Types.ObjectId(id) }],
        }, 'findOne');
        if (!version) {
            return res.send({ status: false, statusText: 'Version not found.' });
        }
        // Route the restore through updatePage semantics: snapshot current, apply old.
        req.body = { contentHtml: (version.content && version.content.html) || '', title: version.title, userData };
        return exports.updatePage(req, res);
    } catch (error) {
        logger.error(`ERROR in restore page version: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

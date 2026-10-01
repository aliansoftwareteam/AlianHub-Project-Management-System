const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { tenantOf } = require('../../Config/tenant');
const { fail } = require('../../Config/respond');
const logger = require('../../Config/loggerConfig');
const { emitPageChange } = require('./helpers/pageEvents');
const { canUsePage } = require('./helpers/pageAccess');
const { isObjectIdString, reviewState } = require('./helpers/pageRules');
const { EDITOR_VERSION, blocksToHtml, blocksToRawText } = require('./helpers/pageContent');
const rules = require('./helpers/pageVersionRules');
const versions = require('./helpers/pageVersions');

const PAGE_NOT_FOUND = 'Page not found.';
const VERSION_NOT_FOUND = 'Version not found.';
const NAMED_FULL = `A doc can have up to ${rules.MAX_NAMED_VERSIONS} named versions. Clear a name to add another.`;

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const callerId = (req) => String((req && req.uid) || '');

const failed = (res, name, error) => {
    logger.error(`ERROR in ${name}: ${error.message}`);
    return fail(res, error.message, error.statusCode || 500);
};

/* The request's live doc for a caller who can read it, and with `edit` change it; answers the refusal itself and
 * returns null. A doc the caller cannot read answers the same as one that does not exist. */
const loadPage = async (req, res, { edit = false } = {}) => {
    const companyId = tenantOf(req);
    const uid = callerId(req);
    const { id } = req.params;
    const page = isObjectIdString(id)
        ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PAGES, data: [{ _id: oid(id), deletedStatusKey: 0 }] }, 'findOne')
        : null;
    if (!(await canUsePage(companyId, page, uid))) {
        fail(res, PAGE_NOT_FOUND, 404);
        return null;
    }
    if (edit && !(await canUsePage(companyId, page, uid, { edit: true }))) {
        fail(res, 'You do not have permission to change this doc.', 403);
        return null;
    }
    return { companyId, uid, page };
};

/* A version the caller may not see answers the same as one that does not exist. */
const loadVersion = async (req, res, { companyId, uid, page }) => {
    const version = await versions.versionOf(companyId, page._id, req.params.versionId);
    if (!rules.versionVisibleTo(version, page, uid)) {
        fail(res, VERSION_NOT_FOUND, 404);
        return null;
    }
    return version;
};

const namedIsFull = async (companyId, page) => (await versions.namedCount(companyId, page._id)) >= rules.MAX_NAMED_VERSIONS;

/* GET /api/v2/pages/:id/versions — newest first, without content. */
exports.listVersions = async (req, res) => {
    try {
        const target = await loadPage(req, res);
        if (!target) return undefined;
        const { companyId, uid, page } = target;
        const rows = await versions.rowsOf(companyId, page._id);
        const data = rows.filter((version) => rules.versionVisibleTo(version, page, uid)).map(rules.versionRow);
        return res.send({ status: true, statusText: 'Versions fetched.', data });
    } catch (error) {
        return failed(res, 'list page versions', error);
    }
};

/* GET /api/v2/pages/:id/versions/:versionId — one version with its blocks, rebuilt the way a save rebuilds them. */
exports.getVersion = async (req, res) => {
    try {
        const target = await loadPage(req, res);
        if (!target) return undefined;
        const version = await loadVersion(req, res, target);
        if (!version) return undefined;
        return res.send({ status: true, statusText: 'Version fetched.', data: rules.versionBody(version) });
    } catch (error) {
        return failed(res, 'get page version', error);
    }
};

/* POST /api/v2/pages/:id/versions  body: { name? } — keeps the doc as it is now. */
exports.saveVersion = async (req, res) => {
    try {
        const named = rules.readName((req.body || {}).name);
        if (named.reason) return fail(res, named.reason, 400);
        const target = await loadPage(req, res, { edit: true });
        if (!target) return undefined;
        const { companyId, uid, page } = target;

        const state = rules.snapshotOf(page);
        if (!state.blocks.length) return fail(res, 'There is nothing in this doc to keep yet.', 400);
        const latest = await versions.latestOf(companyId, page._id);
        const held = rules.heldBy(latest, state, rules.markOf(page));

        if (held && (!named.name || named.name === latest.name)) {
            return res.send({ status: true, statusText: 'This version is already saved.', data: rules.versionRow(latest) });
        }
        if (named.name && !(held && latest.name) && await namedIsFull(companyId, page)) return fail(res, NAMED_FULL, 400);
        if (held) {
            const renamed = await versions.setName(companyId, latest, named.name);
            return res.send({ status: true, statusText: 'Version named.', data: rules.versionRow(renamed || latest) });
        }

        const now = new Date();
        const saved = await versions.keep(companyId, page, { reason: 'manual', savedBy: uid, savedAt: now, name: named.name, state, now });
        if (!saved) return fail(res, 'This doc is too large to keep as a version.', 400);
        return res.send({ status: true, statusText: 'Version saved.', data: rules.versionRow(saved) });
    } catch (error) {
        return failed(res, 'save page version', error);
    }
};

/* PUT /api/v2/pages/:id/versions/:versionId  body: { name } — an empty name clears it. */
exports.renameVersion = async (req, res) => {
    try {
        const named = rules.readName((req.body || {}).name);
        if (named.reason) return fail(res, named.reason, 400);
        const target = await loadPage(req, res, { edit: true });
        if (!target) return undefined;
        const version = await loadVersion(req, res, target);
        if (!version) return undefined;
        const { companyId, page } = target;

        if (named.name && !version.name && await namedIsFull(companyId, page)) return fail(res, NAMED_FULL, 400);
        const renamed = await versions.setName(companyId, version, named.name);
        if (!renamed) return fail(res, VERSION_NOT_FOUND, 404);
        return res.send({ status: true, statusText: named.name ? 'Version named.' : 'Version name cleared.', data: rules.versionRow(renamed) });
    } catch (error) {
        return failed(res, 'rename page version', error);
    }
};

/* POST /api/v2/pages/:id/versions/:versionId/restore — the current state is kept as a version before it is replaced;
 * if that fails the doc is left alone. Nobody is notified of a mention an old version brings back. */
exports.restoreVersion = async (req, res) => {
    try {
        const target = await loadPage(req, res, { edit: true });
        if (!target) return undefined;
        const version = await loadVersion(req, res, target);
        if (!version) return undefined;
        const { companyId, uid, page } = target;

        const now = new Date();
        await versions.keepOutgoing(companyId, page, uid, { now, reason: 'restore' });

        const blocks = rules.blocksOf(version.content);
        const update = {
            title: String(version.title || page.title),
            content: { html: blocksToHtml(blocks), blocks: { time: now.getTime(), blocks, version: EDITOR_VERSION } },
            rawText: blocksToRawText(blocks),
            updatedBy: uid,
            editedBy: uid,
            editedAt: now,
        };
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PAGES,
            data: [{ _id: oid(page._id), deletedStatusKey: 0 }, { $set: update }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (!updated) return fail(res, PAGE_NOT_FOUND, 404);

        emitPageChange(companyId, 'update', updated);
        const data = typeof updated.toObject === 'function' ? updated.toObject() : updated;
        data.reviewState = reviewState(data);
        return res.send({ status: true, statusText: 'Version restored.', data });
    } catch (error) {
        return failed(res, 'restore page version', error);
    }
};

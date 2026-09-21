const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { recordAudit } = require('../Audit/recorder');
const flag = require('../Knowledge/flag');
const figures = require('../Knowledge/figures');
const controls = require('../Knowledge/controls');
const reindex = require('../Knowledge/reindex');

const ENV_KEY = 'KNOWLEDGE_INDEXER';
const ADMIN_KEY_ACTOR = 'instance-admin-key';
const DEFAULT_PAGE_SIZE = 20;
const EXCLUSION_LIMIT = 200;
const MAX_PAGE_SIZE = 100;
const COMPANY_BATCH = 10;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const ACTIONS = Object.freeze({
    REINDEX: 'knowledge.reindex',
    REEMBED: 'knowledge.reembed',
    RETRY_FILES: 'knowledge.retry_files',
    ERASE_DOCUMENT: 'knowledge.erase_document',
    ERASE_PERSON: 'knowledge.erase_person',
    REINDEX_CANCEL: 'knowledge.reindex_cancel',
    EXCLUSION_REMOVE: 'knowledge.exclusion_remove',
});

// The screen translates these; statusText is the English fallback for scripts and for a code it does not know.
const CODE = Object.freeze({
    INDEXER_OFF: 'indexer_off',
    WORKSPACE_INDEXER_OFF: 'workspace_indexer_off',
    INVALID_COMPANY_ID: 'invalid_company_id',
    UNKNOWN_WORKSPACE: 'unknown_workspace',
    INVALID_SOURCE_TYPE: 'invalid_source_type',
    INVALID_DOCUMENT_ID: 'invalid_document_id',
    INVALID_USER_ID: 'invalid_user_id',
    CONFIRMATION_MISMATCH: 'confirmation_mismatch',
    BACKFILL_PENDING: 'backfill_pending',
    BACKFILL_RUNNING: 'backfill_running',
    REINDEX_RUNNING: 'reindex_running',
    NOT_HYBRID: 'not_hybrid',
    EMBEDDING_UNCONFIGURED: 'embedding_unconfigured',
    EMBEDDING_PAUSED: 'embedding_paused',
    REEMBED_RUNNING: 'reembed_running',
    REINDEX_NOT_RUNNING: 'reindex_not_running',
    NOTHING_ERASED: 'nothing_erased',
    NOT_FOUND: 'not_found',
    INVALID_EXCLUSION_ID: 'invalid_exclusion_id',
    FIGURES_TIMED_OUT: 'figures_timed_out',
    SERVER_ERROR: 'server_error',
});

const REFUSALS = {
    [CODE.BACKFILL_PENDING]: [409, 'This source has not been backfilled yet; the backfill job builds it first.'],
    [CODE.BACKFILL_RUNNING]: [409, 'This source is still being backfilled or caught up; re-index it once that is done.'],
    [CODE.REINDEX_RUNNING]: [409, 'A re-index of this source is already running.'],
    [CODE.NOT_HYBRID]: [409, 'Re-embedding needs the workspace in hybrid retrieval mode.'],
    [CODE.EMBEDDING_UNCONFIGURED]: [409, 'No embedding key is configured for the instance.'],
    [CODE.EMBEDDING_PAUSED]: [409, 'Embedding is paused for this workspace: its budget is spent or the provider kept failing.'],
    [CODE.REEMBED_RUNNING]: [409, 'A re-embed of this workspace is already running.'],
    [CODE.REINDEX_NOT_RUNNING]: [409, 'No re-index of this source is running.'],
};

const ok = (res, statusText, data, status = 200) => res.status(status).send({ status: true, statusText, data });
const fail = (res, status, code, statusText) => res.status(status).send({ status: false, statusText, code });
const refuse = (res, code) => fail(res, REFUSALS[code][0], code, REFUSALS[code][1]);
const serverError = (res) => fail(res, 500, CODE.SERVER_ERROR, 'The knowledge index could not be read or changed; the server log has the cause.');

const indexerState = () => ({ mode: flag.indexer.mode(), envKey: ENV_KEY });

const within = (value, fallback, min, max) => {
    const n = Number(value);
    if (Number.isNaN(n) || n === 0) return Math.min(max, Math.max(min, fallback));
    return Math.min(max, Math.max(min, Math.floor(n)));
};

const inBatches = async (items, size, fn) => {
    const out = [];
    for (let i = 0; i < items.length; i += size) {
        // eslint-disable-next-line no-await-in-loop
        out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
    }
    return out;
};

const findCompany = (id) => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
    type: SCHEMA_TYPE.COMPANIES,
    data: [{ _id: new mongoose.Types.ObjectId(id) }, 'Cst_CompanyName'],
}, 'findOne');

const userNames = async (ids) => {
    const wanted = [...new Set(ids.map(String).filter((id) => OBJECT_ID.test(id)))];
    if (!wanted.length) return new Map();
    const users = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.USERS, data: [{ _id: { $in: wanted } }, { Employee_Name: 1 }] }, 'find');
    return new Map((users || []).map((user) => [String(user._id), user.Employee_Name || '']));
};

const userName = async (id) => (await userNames([id])).get(String(id)) || '';

const clientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'] || req.ip;
    return forwarded ? String(forwarded).split(',')[0] : '';
};

const byAdminKey = (req) => req.instanceAdmin === 'key';
const actorOf = (req) => (byAdminKey(req) ? ADMIN_KEY_ACTOR : String(req.uid || ''));

const audit = (req, companyId, { action, entityType, entityId, meta }) => {
    const actorId = actorOf(req);
    userName(actorId)
        .catch((error) => {
            logger.error(`knowledge console audit actor ${actorId}: ${error.message || error}`);
            return '';
        })
        .then((actorName) => recordAudit(companyId, {
            actorId,
            actorName,
            ip: clientIp(req),
            action,
            entityType,
            entityId,
            meta: byAdminKey(req) ? { ...meta, via: 'admin_key' } : meta,
        }));
};

/* Every read and write after the lookup uses the id as the lookup returned it: the path may name the
 * workspace in capitals, and the id is also the name of its database. */
const workspaceOf = async (req, res) => {
    const id = String(req.params.companyId || '');
    if (!OBJECT_ID.test(id)) {
        fail(res, 400, CODE.INVALID_COMPANY_ID, 'companyId must be a workspace id.');
        return null;
    }
    const company = await findCompany(id);
    if (!company) {
        fail(res, 404, CODE.UNKNOWN_WORKSPACE, 'No such workspace.');
        return null;
    }
    return { id: String(company._id).toLowerCase(), name: company.Cst_CompanyName || '' };
};

const indexerOff = (res) => fail(res, 409, CODE.INDEXER_OFF, `${ENV_KEY} is off, so nothing is indexed and nothing here can be changed. Set it and restart.`);

/* Re-index, re-embed and retry queue work the indexer does, so they need it on. Erasure and a cancel
 * only remove or stop, and what was indexed before the indexer went off must stay erasable. */
const control = ({ needsIndexer }, handler) => async (req, res) => {
    if (needsIndexer && flag.indexer.mode() === 'off') return indexerOff(res);
    try {
        const workspace = await workspaceOf(req, res);
        if (!workspace) return undefined;
        if (needsIndexer && !(await flag.indexer.enabledFor(workspace.id))) {
            return fail(res, 409, CODE.WORKSPACE_INDEXER_OFF, 'The indexer is off for this workspace, so there is nothing to run.');
        }
        const answered = await handler(req, res, workspace);
        figures.forget(workspace.id);
        return answered;
    } catch (error) {
        logger.error(`knowledge console ${req.method} ${req.path}: ${error.message || error}`);
        return serverError(res);
    }
};

exports.summary = async (req, res) => {
    try {
        const pageSize = within(req.query.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
        const total = Number(await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.COMPANIES, data: [{}] }, 'countDocuments')) || 0;
        const page = within(req.query.page, 1, 1, Math.max(1, Math.ceil(total / pageSize)));
        const companies = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
            type: SCHEMA_TYPE.COMPANIES,
            data: [{}, 'Cst_CompanyName createdAt', { sort: { createdAt: -1, _id: -1 }, skip: (page - 1) * pageSize, limit: pageSize }],
        }, 'find');
        const workspaces = await inBatches(companies || [], COMPANY_BATCH, (company) => figures.summaryRow(company));
        return ok(res, 'Knowledge sources summary.', {
            indexer: indexerState(),
            retrievalMode: flag.mode(),
            reindexable: reindex.reindexable(),
            documentTypes: controls.documentTypes(),
            page,
            pageSize,
            total,
            workspaces,
        });
    } catch (error) {
        logger.error(`knowledge console summary: ${error.message || error}`);
        return serverError(res);
    }
};

exports.workspace = async (req, res) => {
    try {
        const workspace = await workspaceOf(req, res);
        if (!workspace) return undefined;
        const refresh = ['1', 'true'].includes(String(req.query.refresh || ''));
        const data = await figures.workspaceFigures(workspace.id, { refresh });
        return ok(res, 'Knowledge sources of one workspace.', { ...data, name: workspace.name, indexer: indexerState() });
    } catch (error) {
        if (error && error.code === figures.TIMED_OUT) return fail(res, 503, CODE.FIGURES_TIMED_OUT, error.message);
        logger.error(`knowledge console workspace ${req.params.companyId}: ${error.message || error}`);
        return serverError(res);
    }
};

const reindexableType = (req, res) => {
    const sourceType = req.body && req.body.sourceType;
    if (typeof sourceType === 'string' && reindex.reindexable().includes(sourceType)) return sourceType;
    fail(res, 400, CODE.INVALID_SOURCE_TYPE, `sourceType must be one of ${reindex.reindexable().join(', ')}.`);
    return null;
};

exports.reindex = control({ needsIndexer: true }, async (req, res, workspace) => {
    const sourceType = reindexableType(req, res);
    if (!sourceType) return undefined;
    const asked = await reindex.request(workspace.id, sourceType, { requestedBy: actorOf(req) });
    if (!asked.ok) return refuse(res, asked.code);
    reindex.kick(workspace.id, sourceType);
    audit(req, workspace.id, { action: ACTIONS.REINDEX, entityType: 'knowledge_source', entityId: sourceType, meta: { sourceType } });
    return ok(res, 'Re-index started.', { sourceType, requestedAt: asked.state.reindexRequestedAt }, 202);
});

exports.cancelReindex = control({ needsIndexer: false }, async (req, res, workspace) => {
    const sourceType = reindexableType(req, res);
    if (!sourceType) return undefined;
    const result = await reindex.cancel(workspace.id, sourceType);
    if (!result.ok) return refuse(res, result.code);
    audit(req, workspace.id, { action: ACTIONS.REINDEX_CANCEL, entityType: 'knowledge_source', entityId: sourceType, meta: { sourceType } });
    return ok(res, 'Re-index cancelled.', { sourceType });
});

exports.reembed = control({ needsIndexer: true }, async (req, res, workspace) => {
    const result = await controls.reembed(workspace.id);
    if (!result.ok) return refuse(res, result.code);
    audit(req, workspace.id, { action: ACTIONS.REEMBED, entityType: 'knowledge_embeddings', entityId: result.model, meta: { model: result.model, pendingChunks: result.pendingChunks } });
    return ok(res, 'Re-embed started.', { model: result.model, pendingChunks: result.pendingChunks }, 202);
});

exports.retryFiles = control({ needsIndexer: true }, async (req, res, workspace) => {
    const { reset, byReason } = await controls.retryFiles(workspace.id);
    audit(req, workspace.id, { action: ACTIONS.RETRY_FILES, entityType: 'knowledge_source', entityId: 'file', meta: { reset, byReason } });
    return ok(res, 'Failed files queued again.', { reset, byReason });
});

/* The audit row is written however the erasure ends: one that throws partway is recorded as partial,
 * with what it removed before it did. */
const erasing = async (req, res, workspace, entry, exists, run) => {
    if (!(await exists())) {
        audit(req, workspace.id, { ...entry, meta: { ...entry.meta, removed: {}, total: 0, notFound: true } });
        return fail(res, 404, CODE.NOT_FOUND, 'Nothing by that id exists in this workspace, so nothing was erased and no exclusion was recorded.');
    }
    const progress = { removed: {}, excluded: false };
    let failure = null;
    try {
        await run(progress);
    } catch (error) {
        failure = error;
    } finally {
        const total = controls.totalOf(progress.removed);
        const changed = progress.excluded || total > 0;
        const outcome = failure ? { [changed ? 'partial' : 'failed']: true, error: CODE.SERVER_ERROR } : {};
        audit(req, workspace.id, { ...entry, meta: { ...entry.meta, removed: progress.removed, total, ...outcome } });
    }
    if (failure) {
        logger.error(`knowledge console erasure in ${workspace.id}: ${failure.message || failure}`);
        return serverError(res);
    }
    const data = { removed: progress.removed, total: controls.totalOf(progress.removed) };
    if (!data.total) {
        return res.send({ status: true, code: CODE.NOTHING_ERASED, statusText: 'Nothing in the index matched. The exclusion is recorded, so it stays out if it is indexed later.', data });
    }
    return ok(res, 'Erased from the knowledge index.', data);
};

exports.eraseDocument = control({ needsIndexer: false }, async (req, res, workspace) => {
    const { sourceType, sourceId, confirm } = req.body || {};
    if (typeof sourceType !== 'string' || !controls.documentTypes().includes(sourceType)) {
        return fail(res, 400, CODE.INVALID_SOURCE_TYPE, `sourceType must be one of ${controls.documentTypes().join(', ')}.`);
    }
    const id = controls.canonicalDocumentId(sourceType, sourceId);
    if (!id) return fail(res, 400, CODE.INVALID_DOCUMENT_ID, `That is not a ${sourceType} id.`);
    if (controls.canonicalDocumentId(sourceType, confirm) !== id) return fail(res, 400, CODE.CONFIRMATION_MISMATCH, 'Type the document id to confirm the erasure.');
    return erasing(req, res, workspace, { action: ACTIONS.ERASE_DOCUMENT, entityType: sourceType, entityId: id, meta: { sourceType } },
        () => controls.documentExists(workspace.id, sourceType, id),
        (progress) => controls.eraseDocument(workspace.id, { sourceType, sourceId: id }, progress, { by: actorOf(req) }));
});

exports.erasePerson = control({ needsIndexer: false }, async (req, res, workspace) => {
    const { userId, confirm } = req.body || {};
    const id = controls.canonicalObjectId(userId);
    if (!id) return fail(res, 400, CODE.INVALID_USER_ID, 'userId must be a user id.');
    if (controls.canonicalObjectId(confirm) !== id) return fail(res, 400, CODE.CONFIRMATION_MISMATCH, "Type the person's user id to confirm the erasure.");
    return erasing(req, res, workspace, { action: ACTIONS.ERASE_PERSON, entityType: 'user', entityId: id, meta: {} },
        () => controls.personExists(workspace.id, id),
        (progress) => controls.erasePerson(workspace.id, id, progress, { by: actorOf(req) }));
});

const exclusionStore = (companyId, data, method) => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS, data }, method);

exports.exclusions = control({ needsIndexer: false }, async (req, res, workspace) => {
    const [rows, total] = await Promise.all([
        exclusionStore(workspace.id, [{}, 'kind sourceType sourceId userId erasedAt erasedBy erasedChunks', { sort: { erasedAt: -1, _id: -1 }, limit: EXCLUSION_LIMIT, lean: true }], 'find'),
        exclusionStore(workspace.id, [{}], 'countDocuments'),
    ]);
    const names = await userNames((rows || []).map((row) => row.erasedBy || ''));
    return ok(res, 'Knowledge exclusions.', {
        total: Number(total) || 0,
        limit: EXCLUSION_LIMIT,
        exclusions: (rows || []).map((row) => ({
            id: String(row._id),
            kind: row.kind,
            sourceType: row.sourceType || '',
            sourceId: row.sourceId || '',
            userId: row.userId || '',
            erasedAt: row.erasedAt || null,
            erasedBy: row.erasedBy || '',
            erasedByName: names.get(String(row.erasedBy || '')) || '',
            erasedChunks: Number(row.erasedChunks) || 0,
        })),
    });
});

const leadingIdLowered = (value) => String(value).replace(/^[a-f0-9]{24}/i, (hex) => hex.toLowerCase());

exports.removeExclusion = control({ needsIndexer: false }, async (req, res, workspace) => {
    const id = controls.canonicalObjectId(req.params.exclusionId);
    if (!id) return fail(res, 400, CODE.INVALID_EXCLUSION_ID, 'exclusionId must be an exclusion id.');
    const row = await exclusionStore(workspace.id, [{ _id: new mongoose.Types.ObjectId(id) }, null, { lean: true }], 'findOne');
    if (!row) return fail(res, 404, CODE.NOT_FOUND, 'No such exclusion in this workspace.');
    const expected = row.kind === 'author' ? row.userId : row.sourceId;
    const confirm = req.body && req.body.confirm;
    if (typeof confirm !== 'string' || leadingIdLowered(confirm) !== leadingIdLowered(expected)) {
        return fail(res, 400, CODE.CONFIRMATION_MISMATCH, 'Type the id the exclusion names to confirm its removal.');
    }
    await exclusionStore(workspace.id, [{ _id: new mongoose.Types.ObjectId(id) }], 'deleteOne');
    const named = Object.fromEntries(['sourceType', 'sourceId', 'userId'].filter((field) => row[field]).map((field) => [field, row[field]]));
    audit(req, workspace.id, { action: ACTIONS.EXCLUSION_REMOVE, entityType: 'knowledge_exclusion', entityId: id, meta: { kind: row.kind, ...named } });
    return ok(res, 'Exclusion removed; the item is indexed again at its next change or re-index.', { removed: true });
});

module.exports.ACTIONS = ACTIONS;
module.exports.CODE = CODE;
module.exports.ADMIN_KEY_ACTOR = ADMIN_KEY_ACTOR;

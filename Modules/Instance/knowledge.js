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
const MAX_PAGE_SIZE = 100;
const COMPANY_BATCH = 10;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const ACTIONS = Object.freeze({
    REINDEX: 'knowledge.reindex',
    REEMBED: 'knowledge.reembed',
    RETRY_FILES: 'knowledge.retry_files',
    ERASE_DOCUMENT: 'knowledge.erase_document',
    ERASE_PERSON: 'knowledge.erase_person',
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
};

const ok = (res, statusText, data, status = 200) => res.status(status).send({ status: true, statusText, data });
const fail = (res, status, code, statusText) => res.status(status).send({ status: false, statusText, code });
const refuse = (res, code) => fail(res, REFUSALS[code][0], code, REFUSALS[code][1]);
const serverError = (res) => fail(res, 500, CODE.SERVER_ERROR, 'The knowledge index could not be read or changed; the server log has the cause.');

const indexerState = () => ({ mode: flag.indexer.mode(), envKey: ENV_KEY });

/* A whole number within [min, max], from a query value that may be anything; 1e308 and Infinity land on max. */
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

const userName = async (id) => {
    if (!OBJECT_ID.test(id)) return '';
    const user = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.USERS, data: [{ _id: id }, { Employee_Name: 1 }] }, 'findOne');
    return (user && user.Employee_Name) || '';
};

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

/* The workspace named in the path, checked and read; answers the refusal itself when there is none. */
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
    return { id, name: company.Cst_CompanyName || '' };
};

const indexerOff = (res) => fail(res, 409, CODE.INDEXER_OFF, `${ENV_KEY} is off, so nothing is indexed and nothing here can be changed. Set it and restart.`);

/* Re-index, re-embed and retry only queue work the indexer does, so they need it on for the workspace. */
const control = ({ needsWorkspaceIndexer }, handler) => async (req, res) => {
    if (flag.indexer.mode() === 'off') return indexerOff(res);
    try {
        const workspace = await workspaceOf(req, res);
        if (!workspace) return undefined;
        if (needsWorkspaceIndexer && !(await flag.indexer.enabledFor(workspace.id))) {
            return fail(res, 409, CODE.WORKSPACE_INDEXER_OFF, 'The indexer is off for this workspace, so there is nothing to run.');
        }
        return await handler(req, res, workspace);
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
        const data = await figures.workspaceFigures(workspace.id);
        return ok(res, 'Knowledge sources of one workspace.', { ...data, name: workspace.name, indexer: indexerState() });
    } catch (error) {
        logger.error(`knowledge console workspace ${req.params.companyId}: ${error.message || error}`);
        return serverError(res);
    }
};

exports.reindex = control({ needsWorkspaceIndexer: true }, async (req, res, workspace) => {
    const sourceType = req.body && req.body.sourceType;
    if (typeof sourceType !== 'string' || !reindex.reindexable().includes(sourceType)) {
        return fail(res, 400, CODE.INVALID_SOURCE_TYPE, `sourceType must be one of ${reindex.reindexable().join(', ')}.`);
    }
    const asked = await reindex.request(workspace.id, sourceType, { requestedBy: actorOf(req) });
    if (!asked.ok) return refuse(res, asked.code);
    reindex.kick(workspace.id, sourceType);
    audit(req, workspace.id, { action: ACTIONS.REINDEX, entityType: 'knowledge_source', entityId: sourceType, meta: { sourceType } });
    return ok(res, 'Re-index started.', { sourceType, requestedAt: asked.state.reindexRequestedAt }, 202);
});

exports.reembed = control({ needsWorkspaceIndexer: true }, async (req, res, workspace) => {
    const result = await controls.reembed(workspace.id);
    if (!result.ok) return refuse(res, result.code);
    audit(req, workspace.id, { action: ACTIONS.REEMBED, entityType: 'knowledge_embeddings', entityId: result.model, meta: { model: result.model, pendingChunks: result.pendingChunks } });
    return ok(res, 'Re-embed started.', { model: result.model, pendingChunks: result.pendingChunks }, 202);
});

exports.retryFiles = control({ needsWorkspaceIndexer: true }, async (req, res, workspace) => {
    const { reset, byReason } = await controls.retryFiles(workspace.id);
    audit(req, workspace.id, { action: ACTIONS.RETRY_FILES, entityType: 'knowledge_source', entityId: 'file', meta: { reset, byReason } });
    return ok(res, 'Failed files queued again.', { reset, byReason });
});

exports.eraseDocument = control({ needsWorkspaceIndexer: false }, async (req, res, workspace) => {
    const { sourceType, sourceId, confirm } = req.body || {};
    if (typeof sourceType !== 'string' || !controls.documentTypes().includes(sourceType)) {
        return fail(res, 400, CODE.INVALID_SOURCE_TYPE, `sourceType must be one of ${controls.documentTypes().join(', ')}.`);
    }
    if (!controls.validDocumentId(sourceType, sourceId)) return fail(res, 400, CODE.INVALID_DOCUMENT_ID, `That is not a ${sourceType} id.`);
    if (confirm !== sourceId) return fail(res, 400, CODE.CONFIRMATION_MISMATCH, 'Type the document id to confirm the erasure.');
    const { removed, total } = await controls.eraseDocument(workspace.id, { sourceType, sourceId });
    audit(req, workspace.id, { action: ACTIONS.ERASE_DOCUMENT, entityType: sourceType, entityId: sourceId, meta: { sourceType, removed, total } });
    return ok(res, 'Erased from the knowledge index.', { removed, total });
});

exports.erasePerson = control({ needsWorkspaceIndexer: false }, async (req, res, workspace) => {
    const { userId, confirm } = req.body || {};
    if (typeof userId !== 'string' || !OBJECT_ID.test(userId)) return fail(res, 400, CODE.INVALID_USER_ID, 'userId must be a user id.');
    if (confirm !== (workspace.name || workspace.id)) return fail(res, 400, CODE.CONFIRMATION_MISMATCH, 'Type the workspace name to confirm the erasure.');
    const { removed, total } = await controls.erasePerson(workspace.id, userId);
    audit(req, workspace.id, { action: ACTIONS.ERASE_PERSON, entityType: 'user', entityId: userId, meta: { removed, total } });
    return ok(res, 'Erased from the knowledge index.', { removed, total });
});

module.exports.ACTIONS = ACTIONS;
module.exports.CODE = CODE;
module.exports.ADMIN_KEY_ACTOR = ADMIN_KEY_ACTOR;

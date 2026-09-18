const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { getRoleType, isPrivileged } = require("../../Config/permissionGuard");
const logger = require("../../Config/loggerConfig");
const { csvRow } = require('../../utils/csv');
const chain = require('./chain');
const { AMENDED_ACTION } = require('./helpers/chainRules');

const AUDIT_EXPORT_HARD_CAP = 100000;
const AUDIT_EXPORT_PAGE_SIZE = 1000;
const AUDIT_CSV_HEADER = ['time', 'actorType', 'actor', 'agent', 'run', 'event', 'entity', 'reason', 'cost_usd', 'undone_at'];
const PERMISSION_REFUSED = 'permission.refused';

const companyOf = (req) => req.headers['companyid'] || (req.query && req.query.companyId);

/* Each agent action row carries the deadline the undo route will enforce, so the
 * list can show it instead of computing one. Runs are read once per page. */
const withUndoState = async (companyId, uid, rows) => {
    const undo = require('../Agents/undo');
    const actionRows = rows.filter((r) => r && r.action === 'agent.action');
    if (!actionRows.length) return rows;
    const actor = { kind: 'human', userId: String(uid || '') };
    const ctx = await undo.undoContext(companyId, actor);
    const runIds = [...new Set(actionRows.map((r) => r.meta && r.meta.runId).filter((id) => id && /^[0-9a-fA-F]{24}$/.test(String(id))))];
    const runs = runIds.length
        ? (await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_RUNS, data: [{ _id: { $in: runIds.map((id) => new mongoose.Types.ObjectId(String(id))) } }, { projectId: 1, finishedAt: 1 }] }, 'find').catch(() => [])) || []
        : [];
    const runById = new Map(runs.map((r) => [String(r._id), r]));
    const out = [];
    for (const row of rows) {
        if (row.action !== 'agent.action') { out.push(row); continue; }
        const run = row.meta && row.meta.runId ? runById.get(String(row.meta.runId)) || null : null;
        // eslint-disable-next-line no-await-in-loop
        const state = await undo.undoStateOf(companyId, row, actor, { ...ctx, run });
        out.push({ ...row, undoUntil: state.undoUntil, undoable: state.undoable, undoReason: state.reason });
    }
    return out;
};

// POST /api/v1/audit-logs/:id/undo — replay the inverse of an agent action, logged
// as the person pressing Undo. A member who can see the project may undo while
// the company's undo window is open; an agent token may not.
exports.undoAuditLog = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const { resolveActor, isAgent } = require('../Agents/actor');
        const { undoAuditRow } = require('../Agents/undo');
        const agentAudit = require('../Agents/agentAudit');
        const actor = await resolveActor(req);
        if (isAgent(actor) || !actor.userId) return res.status(403).json({ status: false, message: 'Agents cannot perform undo', statusText: 'Agents cannot perform undo' });
        const row = await agentAudit.findById(companyId, req.params.id);
        if (!row) return res.status(404).json({ status: false, statusText: 'Audit row not found.' });
        const out = await undoAuditRow(companyId, row, actor, req.ip || '');
        if (!out.ok) {
            const message = out.message || out.reason;
            return res.status(out.status || 409).json({ status: false, statusText: message, message, reason: out.reason, undoUntil: out.undoUntil || null });
        }
        return res.send({ status: true, statusText: 'Undone.', data: out.result });
    } catch (error) {
        logger.error(`undoAuditLog: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

const searchTerm = (text) => String(text).slice(0, 120).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* The stream is one collection, so the agent filters are meta lookups rather than a separate log. */
const auditMatch = (q) => {
    const match = {};
    if (q.actorId) match.actorId = String(q.actorId);
    if (q.entityType) match.entityType = String(q.entityType);
    if (q.entityId) match.entityId = String(q.entityId);
    if (q.action) match.action = String(q.action);
    if (q.actorType === 'agent') match['meta.actorType'] = 'agent';
    if (q.actorType === 'human') match['meta.actorType'] = { $ne: 'agent' };
    if (q.gated === 'true') match.action = 'agent.action_refused';
    if (q.refused === 'true') match.action = PERMISSION_REFUSED;
    if (q.undone === 'true') match['meta.undoneAt'] = { $ne: null };
    if (q.agentId) match['meta.agentId'] = String(q.agentId);
    if (q.runId) match['meta.runId'] = String(q.runId);
    if (q.projectId) match.$or = [{ 'meta.params.projectId': String(q.projectId) }, { projectId: String(q.projectId) }];
    if (q.q) {
        const term = searchTerm(q.q);
        match.$and = [...(match.$and || []), { $or: [
            { entityName: { $regex: term, $options: 'i' } },
            { actorName: { $regex: term, $options: 'i' } },
            { 'meta.action': { $regex: term, $options: 'i' } },
            { 'meta.reason': { $regex: term, $options: 'i' } },
        ] }];
    }
    if (q.from || q.to) {
        match.createdAt = {};
        if (q.from) match.createdAt.$gte = new Date(q.from);
        if (q.to) match.createdAt.$lte = new Date(q.to);
    }
    return match;
};

/* Fields an appended change can set. */
const FOLDED_FIELDS = ['entityType', 'entityId', 'meta.undoneAt', '$and'];

/* The same conditions auditMatch puts on those fields, tested on a row folded from its verified changes. */
const matchesFolded = (row, q) => {
    const meta = row.meta || {};
    if (q.entityType && row.entityType !== String(q.entityType)) return false;
    if (q.entityId && row.entityId !== String(q.entityId)) return false;
    if (q.undone === 'true' && meta.undoneAt == null) return false;
    if (q.q) {
        const pattern = new RegExp(searchTerm(q.q), 'i');
        if (![row.entityName, row.actorName, meta.action, meta.reason].some((v) => typeof v === 'string' && pattern.test(v))) return false;
    }
    return true;
};

/*
 * How to read the rows a filter asks for. A company with chained history reads rows folded from their verified
 * changes. When a filter names a field a change can set, the database narrows to candidates (rows that match as
 * stored, or that a chained change touching that field points at) and each row read back is re-checked on its
 * verified state, so a change that does not verify can neither add a row to the result nor alter one in it.
 */
const auditPlan = async (companyId, q) => {
    if (!(await chain.folding(companyId))) return { folding: false, exact: true, stages: [{ $match: auditMatch(q) }] };
    const base = auditMatch(q);
    const current = {};
    FOLDED_FIELDS.forEach((field) => {
        if (base[field] === undefined) return;
        current[field] = base[field];
        delete base[field];
    });
    const notAmendment = { action: { $ne: AMENDED_ACTION } };
    if (!Object.keys(current).length || !(await chain.hasAmendments(companyId))) {
        const { $and: search = [], ...rest } = current;
        return { folding: true, exact: true, stages: [{ $match: { ...base, ...rest, $and: [notAmendment, ...search] } }] };
    }
    const touching = chain.touchingStages({
        entityType: q.entityType ? String(q.entityType) : '',
        entityId: q.entityId ? String(q.entityId) : '',
        undone: q.undone === 'true',
        term: q.q ? searchTerm(q.q) : '',
    });
    const candidates = touching.length ? { $or: [current, { '_touching.0': { $exists: true } }] } : current;
    return { folding: true, exact: false, stages: [{ $match: { ...base, $and: [notAmendment] } }, ...touching, { $match: candidates }] };
};

const NEWEST_FIRST = { $sort: { createdAt: -1, _id: -1 } };

async function* plannedRows(companyId, q, plan, { integrity }) {
    for (let skip = 0; ; skip += AUDIT_EXPORT_PAGE_SIZE) {
        const batch = (await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AUDIT_LOGS,
            data: [[...plan.stages, NEWEST_FIRST, { $skip: skip }, { $limit: AUDIT_EXPORT_PAGE_SIZE }]],
        }, 'aggregate')) || [];
        const rows = plan.folding ? await chain.annotateRows(companyId, batch, { integrity }) : batch;
        for (const row of rows) {
            if (plan.exact || matchesFolded(row, q)) yield row;
        }
        if (batch.length < AUDIT_EXPORT_PAGE_SIZE) return;
    }
}

// GET /api/v1/audit-logs?actorId=&entityType=&entityId=&action=&refused=&from=&to=&page=&limit=
// Owner/admin only. Filterable + paginated, newest first; under AUDIT_CHAIN each row carries its integrity state.
exports.listAuditLogs = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const roleType = await getRoleType(companyId, req.uid);
        if (!isPrivileged(roleType)) return res.status(403).json({ status: false, statusText: 'Owner/admin only.' });

        const q = req.query || {};
        const page = Math.max(1, Number(q.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(q.limit) || 25));
        const plan = await auditPlan(companyId, q);
        const pipeline = [
            ...plan.stages,
            NEWEST_FIRST,
            { $facet: { data: [{ $skip: (page - 1) * limit }, { $limit: limit }, ...(plan.folding ? [{ $project: { _id: 1 } }] : [])], meta: [{ $count: 'total' }] } },
        ];
        const rows = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AUDIT_LOGS, data: [pipeline] }, 'aggregate');
        const pageRows = (rows && rows[0] && rows[0].data) || [];
        const read = plan.folding ? await chain.readForList(companyId, pageRows.map((r) => r._id)) : pageRows;
        const listed = plan.exact ? read : read.filter((row) => matchesFolded(row, q));
        // The total counts candidates, so once a page drops one the total may count rows that do not match.
        const approximate = listed.length !== read.length;
        const total = (rows && rows[0] && rows[0].meta && rows[0].meta[0] && rows[0].meta[0].total) || 0;
        const data = await withUndoState(companyId, req.uid, listed);
        const metadata = { total, page, totalPages: Math.ceil(total / limit), ...(approximate ? { approximate: true } : {}), ...(chain.isOn() ? { chain: { on: true } } : {}) };
        return res.send({ status: true, data, metadata });
    } catch (error) {
        logger.error(`listAuditLogs: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* AUDIT_EXPORT_MAX_ROWS may lower the cap for a small instance; nothing raises it past what one request should stream. */
exports.auditExportCap = () => {
    const configured = Number(process.env.AUDIT_EXPORT_MAX_ROWS);
    return Number.isInteger(configured) && configured > 0 ? Math.min(configured, AUDIT_EXPORT_HARD_CAP) : AUDIT_EXPORT_HARD_CAP;
};

const integrityCell = (integrity) => {
    if (!integrity) return '';
    return integrity.state === 'broken' && integrity.brokenAt != null ? `broken:${integrity.brokenAt}` : integrity.state;
};

const auditCsvLine = (r, withIntegrity) => {
    const m = r.meta || {};
    return csvRow([
        r.createdAt ? new Date(r.createdAt).toISOString() : '', m.actorType || 'human', r.actorName || '', m.agentName || '', m.runId || '',
        m.action || r.action, r.entityName || r.entityId || '', m.reason || '', (m.cost && m.cost.usd) || '', m.undoneAt ? new Date(m.undoneAt).toISOString() : '',
        ...(withIntegrity ? [integrityCell(r.integrity)] : []),
    ]);
};

/* GET /api/v1/audit-logs/export — every row of the current filter as CSV, streamed a page at a time
 * up to auditExportCap(); a last row says so when the filter holds more. Owner/admin only. */
exports.exportAuditCsv = async (req, res) => {
    let streaming = false;
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const roleType = await getRoleType(companyId, req.uid);
        if (!isPrivileged(roleType)) return res.status(403).json({ status: false, statusText: 'Owner/admin only.' });

        const q = req.query || {};
        const plan = await auditPlan(companyId, q);
        const withIntegrity = chain.isOn();
        const cap = exports.auditExportCap();

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`);
        streaming = true;
        res.write([...AUDIT_CSV_HEADER, ...(withIntegrity ? ['integrity'] : [])].join(','));

        let written = 0;
        let truncated = false;
        let lines = [];
        for await (const row of plannedRows(companyId, q, plan, { integrity: withIntegrity })) {
            if (written >= cap) {
                truncated = true;
                break;
            }
            lines.push(auditCsvLine(row, withIntegrity));
            written += 1;
            if (lines.length >= AUDIT_EXPORT_PAGE_SIZE) {
                res.write(`\n${lines.join('\n')}`);
                lines = [];
            }
        }
        if (lines.length) res.write(`\n${lines.join('\n')}`);
        if (truncated) {
            const note = ['', '', '', '', '', 'export.truncated', `Export truncated at ${cap} rows. Narrow the filter to export the rest.`, '', '', ''];
            res.write(`\n${csvRow([...note, ...(withIntegrity ? [''] : [])])}`);
        }
        return res.end();
    } catch (error) {
        logger.error(`exportAuditCsv: ${error.message}`);
        if (streaming) return res.end();
        return res.status(500).json({ status: false, statusText: error.message });
    }
};

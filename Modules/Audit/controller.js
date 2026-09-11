const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { getRoleType, isPrivileged } = require("../../Config/permissionGuard");
const logger = require("../../Config/loggerConfig");
const { csvRow } = require('../../utils/csv');

const AUDIT_EXPORT_HARD_CAP = 100000;
const AUDIT_EXPORT_PAGE_SIZE = 1000;
const AUDIT_CSV_HEADER = ['time', 'actorType', 'actor', 'agent', 'run', 'event', 'entity', 'reason', 'cost_usd', 'undone_at'];

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
    if (q.undone === 'true') match['meta.undoneAt'] = { $ne: null };
    if (q.agentId) match['meta.agentId'] = String(q.agentId);
    if (q.runId) match['meta.runId'] = String(q.runId);
    if (q.projectId) match.$or = [{ 'meta.params.projectId': String(q.projectId) }, { projectId: String(q.projectId) }];
    if (q.q) {
        const term = String(q.q).slice(0, 120).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

const NEWEST_FIRST = { $sort: { createdAt: -1, _id: -1 } };

// GET /api/v1/audit-logs?actorId=&entityType=&entityId=&action=&from=&to=&page=&limit=
// Owner/admin only. Filterable + paginated, newest first.
exports.listAuditLogs = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const roleType = await getRoleType(companyId, req.uid);
        if (!isPrivileged(roleType)) return res.status(403).json({ status: false, statusText: 'Owner/admin only.' });

        const q = req.query || {};
        const page = Math.max(1, Number(q.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(q.limit) || 25));
        const pipeline = [
            { $match: auditMatch(q) },
            NEWEST_FIRST,
            { $facet: { data: [{ $skip: (page - 1) * limit }, { $limit: limit }], meta: [{ $count: 'total' }] } },
        ];
        const rows = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AUDIT_LOGS, data: [pipeline] }, 'aggregate');
        const data = await withUndoState(companyId, req.uid, (rows && rows[0] && rows[0].data) || []);
        const total = (rows && rows[0] && rows[0].meta && rows[0].meta[0] && rows[0].meta[0].total) || 0;
        return res.send({ status: true, data, metadata: { total, page, totalPages: Math.ceil(total / limit) } });
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

const auditCsvLine = (r) => {
    const m = r.meta || {};
    return csvRow([
        r.createdAt ? new Date(r.createdAt).toISOString() : '', m.actorType || 'human', r.actorName || '', m.agentName || '', m.runId || '',
        m.action || r.action, r.entityName || r.entityId || '', m.reason || '', (m.cost && m.cost.usd) || '', m.undoneAt ? new Date(m.undoneAt).toISOString() : '',
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

        const match = auditMatch(req.query || {});
        const cap = exports.auditExportCap();
        const readPage = async (skip, limit) => (await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AUDIT_LOGS,
            data: [[{ $match: match }, NEWEST_FIRST, { $skip: skip }, { $limit: limit }]],
        }, 'aggregate')) || [];

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`);
        streaming = true;
        res.write(AUDIT_CSV_HEADER.join(','));

        let written = 0;
        while (written < cap) {
            const limit = Math.min(AUDIT_EXPORT_PAGE_SIZE, cap - written);
            // eslint-disable-next-line no-await-in-loop
            const rows = await readPage(written, limit);
            if (rows.length) res.write(`\n${rows.map(auditCsvLine).join('\n')}`);
            written += rows.length;
            if (rows.length < limit) break;
        }
        if (written >= cap && (await readPage(cap, 1)).length) {
            res.write(`\n${csvRow(['', '', '', '', '', 'export.truncated', `Export truncated at ${cap} rows. Narrow the filter to export the rest.`, '', '', ''])}`);
        }
        return res.end();
    } catch (error) {
        logger.error(`exportAuditCsv: ${error.message}`);
        if (streaming) return res.end();
        return res.status(500).json({ status: false, statusText: error.message });
    }
};

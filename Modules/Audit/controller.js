const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { getRoleType, isPrivileged } = require("../../Config/permissionGuard");
const logger = require("../../Config/loggerConfig");

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
        const match = {};
        if (q.actorId) match.actorId = String(q.actorId);
        if (q.entityType) match.entityType = String(q.entityType);
        if (q.entityId) match.entityId = String(q.entityId);
        if (q.action) match.action = String(q.action);
        // 11b filters. The stream is one collection, so these are meta lookups
        // rather than a separate agent log.
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
        const pipeline = [
            { $match: match },
            { $sort: { createdAt: -1, _id: -1 } },
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

/* GET /api/v1/audit-logs/export — the current filter as CSV. Owner/admin only,
 * capped so a year of rows cannot be pulled into memory in one request. */
exports.exportAuditCsv = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const roleType = await getRoleType(companyId, req.uid);
        if (!isPrivileged(roleType)) return res.status(403).json({ status: false, statusText: 'Owner/admin only.' });

        req.query = { ...(req.query || {}), page: 1, limit: 1000 };
        const capture = { payload: null };
        const fake = { send: (b) => { capture.payload = b; return fake; }, status: () => fake, json: (b) => { capture.payload = b; return fake; } };
        await exports.listAuditLogs(req, fake);
        const rows = (capture.payload && capture.payload.data) || [];

        const cell = (v) => {
            const s = v === undefined || v === null ? '' : String(v);
            return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        };
        const header = ['time', 'actorType', 'actor', 'agent', 'run', 'event', 'entity', 'reason', 'cost_usd', 'undone_at'];
        const lines = [header.join(',')].concat(rows.map((r) => {
            const m = r.meta || {};
            const at = r.createdAt ? new Date(r.createdAt).toISOString() : '';
            return [at, m.actorType || 'human', r.actorName || '', m.agentName || '', m.runId || '',
                    m.action || r.action, r.entityName || r.entityId || '', m.reason || '',
                    (m.cost && m.cost.usd) || '', m.undoneAt ? new Date(m.undoneAt).toISOString() : ''].map(cell).join(',');
        }));
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`);
        return res.send(lines.join('\n'));
    } catch (error) {
        logger.error(`exportAuditCsv: ${error.message}`);
        return res.status(500).json({ status: false, statusText: error.message });
    }
};

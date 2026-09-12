const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const registry = require('./registry');
const runs = require('./runs');
const { TYPE_LIST: PROVIDER_ERROR_TYPES } = require('../AICore/providerError');
const proposals = require('./proposals');
const accounts = require('./accounts');
const actions = require('./actions');
const { isAgent } = require('./actor');
const access = require('./access');
const tools = require('../Automations/engine/tools');
const team = require('./team');
const scope = require('./scope');
const shipping = require('./shipping');
const agentAudit = require('./agentAudit');
const { inputsOf } = require('./taskInputs');
const revert = require('./revert');
const undo = require('./undo');
const budget = require('./budget');
const routingPolicy = require('../AICore/routingPolicy');
const modelPin = require('../AICore/modelPin');
const taskClass = require('../AICore/taskClass');
const revisions = require('./revisions');
const skillRecord = require('./skillRecord');
const { buildTrace } = require('./runTrace');

const companyOf = (req) => req.headers['companyid'] || (req.query && req.query.companyId) || '';
// 'mention' is a run started by @naming the agent in a comment (13b); it is
// recorded because "who asked for this" is the first question about any run.
const TRIGGERS = ['manual', 'mention', 'schedule', 'rule', 'assignment'];
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };
const fail = (res, statusText, code, extra) => res.status(code || 400).send({ status: false, statusText, message: statusText, ...(extra || {}) });
const refusalOf = (out) => (out.reason ? { reason: out.reason, undoUntil: out.undoUntil || null } : undefined);
const invalid = (statusText) => Object.assign(new Error(statusText), { status: 400 });
const AUTONOMY_MAX = 3;
const IDEMPOTENCY_KEY_MAX = 200;
const numberOf = (value) => (typeof value === 'number' ? value : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN));

const autonomyOf = (value) => {
    const n = numberOf(value);
    if (!Number.isInteger(n) || n < 0 || n > AUTONOMY_MAX) throw invalid(`autonomy must be between 0 and ${AUTONOMY_MAX}`);
    return n;
};

const runSpendCapOf = (value) => {
    if (value === undefined || value === null) return undefined;
    const n = numberOf(value);
    if (!Number.isFinite(n) || n <= 0) throw invalid('spendCapUsd must be a number greater than 0');
    return n;
};

const idempotencyKeyOf = (req) => {
    const raw = req.headers['idempotency-key'] || (req.body && req.body.idempotencyKey);
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (typeof raw !== 'string' || raw.length > IDEMPOTENCY_KEY_MAX) throw invalid(`idempotencyKey must be a string of at most ${IDEMPOTENCY_KEY_MAX} characters`);
    return raw;
};

const { humanActor, callerOf, canManageAgents, canControlRun, canActAsAgent, visibleProjectIdsFor, REFUSAL } = access;

const refuseUnlessManager = (res, caller, agentsMessage) => {
    if (!caller.human) return fail(res, agentsMessage, 403);
    if (!canManageAgents(caller)) return fail(res, REFUSAL.MANAGE, 403);
    return null;
};

/* The wizard sends skills as objects; map(String) used to store "[object Object]"
 * and every run of that agent then asked for a skill by that name. */
const normaliseSkill = (skill) => {
    if (!skill) return null;
    if (typeof skill === 'string') return { key: skill.slice(0, 80), name: skill.slice(0, 80), enabled: true };
    const key = String(skill.key || skill.slug || skill.name || '').slice(0, 80);
    if (!key) return null;
    return {
        key,
        name: String(skill.name || key).slice(0, 80),
        enabled: skill.enabled !== false,
        ...(Array.isArray(skill.actions) ? { actions: skill.actions.map(String).slice(0, 40) } : {}),
    };
};

/* A pin that cannot be billed or cannot be reached is refused here, so the
 * person who set it hears about it instead of a run failing on it later. */
const refusePin = (res, set) => {
    if (set.model === undefined) return null;
    const pin = modelPin.validatePin(set.model);
    if (!pin.ok) return fail(res, pin.message, 400, { code: pin.code });
    set.model = pin.model;
    return null;
};

const refuseSkills = async (res, companyId, set) => {
    const errors = set.skills ? await skillRecord.checkAgentSkills(companyId, set.skills) : [];
    return errors.length ? fail(res, 'The agent names skills that cannot run.', 400, { data: { errors } }) : null;
};

const agentPatchFields = (body) => {
    const set = {};
    if (body.name !== undefined) set.name = String(body.name).trim().slice(0, 80);
    if (body.description !== undefined) set.description = String(body.description).slice(0, 1000);
    if (body.skills !== undefined && Array.isArray(body.skills)) set.skills = body.skills.slice(0, 20).map(normaliseSkill).filter(Boolean);
    if (body.allowedActions !== undefined && Array.isArray(body.allowedActions)) set.allowedActions = body.allowedActions.filter((a) => registry.has(a));
    if (body.projectIds !== undefined && Array.isArray(body.projectIds)) set.projectIds = body.projectIds.filter((id) => OBJECT_ID.test(String(id))).map(String);
    if (body.autonomy !== undefined) set.autonomy = autonomyOf(body.autonomy);
    if (body.spendCapUsd !== undefined) set.spendCapUsd = Math.max(0, Number(body.spendCapUsd) || 0);
    if (body.account !== undefined && accounts.MODES.includes(body.account)) set.account = body.account;
    if (body.model !== undefined) set.model = String(body.model).slice(0, modelPin.MAX_LENGTH);
    // `schedule` is stored for a scheduler that does not exist yet: nothing reads
    // it, so the UI hides the field. `rateLimitPerDay` is enforced in runs.canStart.
    if (body.schedule !== undefined && typeof body.schedule === 'object') set.schedule = body.schedule;
    if (body.rateLimitPerDay !== undefined) set.rateLimitPerDay = Math.max(0, Number(body.rateLimitPerDay) || 0);
    return set;
};

/* GET /api/v2/agents/registry */
exports.getRegistry = (req, res) => res.send({ status: true, statusText: 'Registry fetched.', data: require('./actions').manifest() });

/* GET /api/v2/agents */
exports.listAgents = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        const rows = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENTS, data: [{ deletedStatusKey: { $ne: 1 } }, {}, { sort: { createdAt: 1 } }] }, 'find');
        return res.send({ status: true, statusText: 'Agents fetched.', data: rows || [] });
    } catch (e) { logger.error(`listAgents: ${e.message}`); return fail(res, e.message, 500); }
};

/* POST /api/v2/agents */
exports.createAgent = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        const caller = await callerOf(req, companyId);
        if (refuseUnlessManager(res, caller, 'Agents cannot create agents.')) return undefined;
        const { actor } = caller;
        const set = agentPatchFields(req.body || {});
        if (!set.name) return fail(res, 'name is required.');
        if (refusePin(res, set)) return undefined;
        if (await refuseSkills(res, companyId, set)) return undefined;
        const saved = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENTS,
            data: { autonomy: 1, spendCapUsd: 30, paused: false, account: 'workspace', deletedStatusKey: 0, ...set, ownerId: actor.userId },
        }, 'save');
        await revisions.recordCreate(companyId, saved, { actor });
        return res.send({ status: true, statusText: 'Agent created.', data: saved });
    } catch (e) { logger.error(`createAgent: ${e.message}`); return fail(res, e.message, e.status || 500); }
};

/* PUT /api/v2/agents/:id — autonomy, spend cap, skills, scope */
exports.updateAgent = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !OBJECT_ID.test(req.params.id)) return fail(res, 'companyId and a valid agent id are required.');
        const caller = await callerOf(req, companyId);
        if (refuseUnlessManager(res, caller, 'Agents cannot edit agents.')) return undefined;
        const { actor } = caller;
        const set = agentPatchFields(req.body || {});
        if (!Object.keys(set).length) return fail(res, 'Nothing to update.');
        if (refusePin(res, set)) return undefined;
        if (await refuseSkills(res, companyId, set)) return undefined;
        const before = await runs.getAgent(companyId, req.params.id);
        if (!before) return fail(res, 'Agent not found.', 404);
        const updated = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENTS, data: [{ _id: oid(req.params.id) }, { $set: set }, { returnDocument: 'after' }] }, 'findOneAndUpdate');
        if (!updated) return fail(res, 'Agent not found.', 404);
        const { revision } = await revisions.recordSave(companyId, before, updated, { actor, ip: req.ip || '' });
        return res.send({ status: true, statusText: 'Agent updated.', data: updated, revision: revision ? Number(revision.n) : null });
    } catch (e) { logger.error(`updateAgent: ${e.message}`); return fail(res, e.message, e.status || 500); }
};

/* POST /api/v2/agents/:id/pause  |  /resume — the kill switch */
exports.setPaused = (paused) => async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !OBJECT_ID.test(req.params.id)) return fail(res, 'companyId and a valid agent id are required.');
        if (refuseUnlessManager(res, await callerOf(req, companyId), 'Agents cannot pause or resume agents.')) return undefined;
        const set = paused ? { paused: true, pausedReason: String((req.body && req.body.reason) || 'manual').slice(0, 120), pausedAt: new Date() } : { paused: false, pausedReason: null, pausedAt: null };
        const updated = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENTS, data: [{ _id: oid(req.params.id) }, { $set: set }, { returnDocument: 'after' }] }, 'findOneAndUpdate');
        if (!updated) return fail(res, 'Agent not found.', 404);
        if (paused) {
            const open = await runs.list(companyId, { status: 'open', agentId: req.params.id });
            for (const r of (open || []).filter((x) => [runs.STATUS.RUNNING, runs.STATUS.QUEUED].includes(x.status))) {
                // eslint-disable-next-line no-await-in-loop
                await runs.stop(companyId, r._id, req.uid);
            }
        }
        return res.send({ status: true, statusText: paused ? 'Agent paused.' : 'Agent resumed.', data: updated });
    } catch (e) { logger.error(`setPaused: ${e.message}`); return fail(res, e.message, 500); }
};

const revisionRow = (r, names = {}) => {
    const o = typeof r.toObject === 'function' ? r.toObject() : { ...r };
    return {
        _id: String(o._id), agentId: o.agentId, n: o.n, state: o.state, snapshot: o.snapshot, serves: o.serves || [], skillRefs: o.skillRefs || [],
        source: o.source || null, rollbackOf: o.rollbackOf || null, note: o.note || null,
        createdBy: o.createdBy || null, createdByName: names[String(o.createdBy)] || null, createdAt: o.createdAt,
        promotedBy: o.promotedBy || null, promotedByName: names[String(o.promotedBy)] || null, promotedAt: o.promotedAt || null, supersededAt: o.supersededAt || null,
    };
};

const userNames = async (rows) => {
    const ids = [...new Set(rows.flatMap((r) => [r.createdBy, r.promotedBy]).filter(Boolean).map(String))].map(oid).filter(Boolean);
    if (!ids.length) return {};
    const { dbCollections } = require('../../Config/collections');
    const users = await MongoDbCrudOpration(dbCollections.GLOBAL, { type: SCHEMA_TYPE.USERS, data: [{ _id: { $in: ids } }, { Employee_Name: 1, Employee_FName: 1, Employee_LName: 1 }] }, 'find').catch(() => []);
    return Object.fromEntries((users || []).map((u) => [String(u._id), u.Employee_Name || [u.Employee_FName, u.Employee_LName].filter(Boolean).join(' ') || null]));
};

/* Revisions are owner/admin ground, like the agent settings page. */
const revisionAccess = async (req, res) => {
    const companyId = companyOf(req);
    if (!companyId || !OBJECT_ID.test(req.params.id)) { fail(res, 'companyId and a valid agent id are required.'); return null; }
    const caller = await callerOf(req, companyId);
    if (!canManageAgents(caller)) { fail(res, 'Owner/admin only.', 403); return null; }
    const { actor } = caller;
    const agent = await runs.getAgent(companyId, req.params.id);
    if (!agent) { fail(res, 'Agent not found.', 404); return null; }
    return { companyId, actor, agent };
};

const revisionN = (raw) => { const n = Number(raw); return Number.isInteger(n) && n > 0 ? n : null; };

/* GET /api/v2/agents/:id/revisions */
exports.listRevisions = async (req, res) => {
    try {
        const ctx = await revisionAccess(req, res);
        if (!ctx) return undefined;
        await revisions.liveFor(ctx.companyId, ctx.agent);
        const rows = await revisions.listFor(ctx.companyId, ctx.agent._id);
        const names = await userNames(rows || []);
        return res.send({ status: true, statusText: 'Revisions fetched.', data: (rows || []).map((r) => revisionRow(r, names)) });
    } catch (e) { logger.error(`listRevisions: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET /api/v2/agents/:id/revisions/:n */
exports.getRevision = async (req, res) => {
    try {
        const ctx = await revisionAccess(req, res);
        if (!ctx) return undefined;
        const n = revisionN(req.params.n);
        const row = n ? await revisions.getRevision(ctx.companyId, ctx.agent._id, n) : null;
        if (!row) return fail(res, 'Revision not found.', 404);
        return res.send({ status: true, statusText: 'Revision fetched.', data: revisionRow(row) });
    } catch (e) { logger.error(`getRevision: ${e.message}`); return fail(res, e.message, 500); }
};

/* POST /api/v2/agents/:id/revisions  body: { state?: draft|candidate, note?, ...agent fields }
 * The only way to a draft or candidate: the plain save always goes live. */
exports.createRevision = async (req, res) => {
    try {
        const ctx = await revisionAccess(req, res);
        if (!ctx) return undefined;
        const body = req.body || {};
        const fields = agentPatchFields(body);
        if (await refuseSkills(res, ctx.companyId, fields)) return undefined;
        const row = await revisions.createDraft(ctx.companyId, ctx.agent, { fields, state: body.state, note: body.note, actor: ctx.actor });
        return res.send({ status: true, statusText: `Revision ${row.n} saved as ${row.state}.`, data: revisionRow(row) });
    } catch (e) { logger.error(`createRevision: ${e.message}`); return fail(res, e.message, e.status || 500); }
};

/* POST /api/v2/agents/:id/revisions/:n/promote */
exports.promoteRevision = async (req, res) => {
    try {
        const ctx = await revisionAccess(req, res);
        if (!ctx) return undefined;
        const n = revisionN(req.params.n);
        if (!n) return fail(res, 'Revision not found.', 404);
        const out = await revisions.promote(ctx.companyId, ctx.agent, n, { actor: ctx.actor, ip: req.ip || '' });
        if (out.error) return fail(res, out.error, out.status || 400, out.errors ? { data: { errors: out.errors } } : undefined);
        return res.send({ status: true, statusText: out.unchanged ? `Revision ${n} is already live.` : `Revision ${n} is live.`, data: { revision: revisionRow(out.revision), from: out.from, agent: out.agent || null } });
    } catch (e) { logger.error(`promoteRevision: ${e.message}`); return fail(res, e.message, 500); }
};

/* POST /api/v2/agents/:id/revisions/:n/rollback — copies :n forward and makes the copy live */
exports.rollbackRevision = async (req, res) => {
    try {
        const ctx = await revisionAccess(req, res);
        if (!ctx) return undefined;
        const n = revisionN(req.params.n);
        if (!n) return fail(res, 'Revision not found.', 404);
        const out = await revisions.rollback(ctx.companyId, ctx.agent, n, { actor: ctx.actor, ip: req.ip || '', note: (req.body || {}).note });
        if (out.error) return fail(res, out.error, out.status || 400, out.errors ? { data: { errors: out.errors } } : undefined);
        return res.send({ status: true, statusText: `Rolled back to revision ${n} as revision ${out.revision.n}.`, data: { revision: revisionRow(out.revision), from: out.from, rollbackOf: out.rollbackOf, agent: out.agent || null } });
    } catch (e) { logger.error(`rollbackRevision: ${e.message}`); return fail(res, e.message, 500); }
};

/* DELETE /api/v2/agents/:id — owner/admin. A soft delete:
 * runs, proposals and audit rows keep naming the agent. */
exports.deleteAgent = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !OBJECT_ID.test(req.params.id)) return fail(res, 'companyId and a valid agent id are required.');
        const caller = await callerOf(req, companyId);
        if (refuseUnlessManager(res, caller, 'Agents cannot delete agents.')) return undefined;
        const { actor } = caller;
        const agent = await runs.getAgent(companyId, req.params.id);
        if (!agent) return fail(res, 'Agent not found.', 404);
        const active = await runs.list(companyId, { status: 'open', agentId: req.params.id });
        const running = (active || []).filter((r) => [runs.STATUS.RUNNING, runs.STATUS.QUEUED].includes(r.status));
        if (running.length) return fail(res, `This agent has ${running.length} run(s) in progress — stop them first.`, 409);
        await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENTS, data: [{ _id: agent._id }, { $set: { deletedStatusKey: 1, deletedAt: new Date(), deletedBy: String(actor.userId), paused: true, pausedReason: 'deleted' } }] }, 'updateOne');
        await agentAudit.recordAgentDeleted(companyId, actor, { agentId: String(agent._id), agentName: agent.name, ip: req.ip || '' });
        runs.emitAgent(companyId, { agentId: String(agent._id), deleted: true });
        return res.send({ status: true, statusText: 'Agent deleted. Its runs and audit history stay.', data: { agentId: String(agent._id) } });
    } catch (e) { logger.error(`deleteAgent: ${e.message}`); return fail(res, e.message, 500); }
};

/* POST /api/v2/agents/pause-all */
exports.pauseAll = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        if (refuseUnlessManager(res, await callerOf(req, companyId), 'Agents cannot pause agents.')) return undefined;
        const out = await runs.pauseAll(companyId, `pause all by ${req.uid}`);
        return res.send({ status: true, statusText: 'All agents paused.', data: out });
    } catch (e) { logger.error(`pauseAll: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET /api/v2/agents/spend?month= */
exports.spend = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        const month = (req.query && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : runs.monthKey());
        const agents = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENTS, data: [{ deletedStatusKey: { $ne: 1 } }, 'name spendCapUsd spendMonth paused pausedReason account'] }, 'find');
        const from = new Date(`${month}-01T00:00:00.000Z`);
        const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
        const byAgent = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENT_RUNS,
            data: [[{ $match: { startedAt: { $gte: from, $lt: to } } },
                    { $group: { _id: { agentId: '$agentId', via: '$viaAccount' }, usd: { $sum: '$spend.usd' }, tokens: { $sum: '$spend.tokens' }, runs: { $sum: 1 } } }]],
        }, 'aggregate').catch(() => []);
        const rows = (agents || []).map((a) => {
            const mine = (byAgent || []).filter((g) => g._id.agentId === String(a._id));
            return { agentId: String(a._id), name: a.name, account: a.account, cap: a.spendCapUsd, paused: a.paused, pausedReason: a.pausedReason,
                     usd: Math.round(mine.reduce((s, g) => s + (g.usd || 0), 0) * 100) / 100, tokens: mine.reduce((s, g) => s + (g.tokens || 0), 0), runs: mine.reduce((s, g) => s + (g.runs || 0), 0) };
        });
        const cli = (byAgent || []).filter((g) => g._id.via === 'personal');
        return res.send({ status: true, statusText: 'Spend fetched.', data: { month, agents: rows, totalUsd: Math.round(rows.reduce((s, r) => s + r.usd, 0) * 100) / 100,
                                                cliAgents: { runs: cli.reduce((s, g) => s + g.runs, 0), usdToWorkspace: 0 } } });
    } catch (e) { logger.error(`spend: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET /api/v2/agents/runs?status=open|running|…&projectId=&agentId=&taskId=&errorType=&limit= */
exports.listRuns = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        const q = req.query || {};
        if (q.errorType && !PROVIDER_ERROR_TYPES.includes(String(q.errorType))) return fail(res, `errorType must be one of: ${PROVIDER_ERROR_TYPES.join(', ')}.`, 400);
        const projectIds = await visibleProjectIdsFor(companyId, await callerOf(req, companyId));
        const [rows, summary] = await Promise.all([runs.list(companyId, { ...q, projectIds }), runs.summary(companyId, { projectId: q.projectId, projectIds })]);
        return res.send({ status: true, statusText: 'Runs fetched.', data: rows || [], summary });
    } catch (e) { logger.error(`listRuns: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET /api/v2/agents/runs/summary?projectId= */
exports.runSummary = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        const q = req.query || {};
        const projectIds = await visibleProjectIdsFor(companyId, await callerOf(req, companyId));
        const [live, counts] = await Promise.all([runs.summary(companyId, { projectId: q.projectId, projectIds }), runs.countsByStatus(companyId, { projectId: q.projectId, agentId: q.agentId, projectIds })]);
        return res.send({ status: true, statusText: 'Run summary fetched.', data: { ...live, counts } });
    } catch (e) { logger.error(`runSummary: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET /api/v2/agents/runs/:id */
exports.getRun = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !OBJECT_ID.test(req.params.id)) return fail(res, 'companyId and a valid run id are required.');
        const run = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_RUNS, data: [{ _id: oid(req.params.id) }] }, 'findOne');
        if (!run) return fail(res, 'Run not found.', 404);
        const caller = await callerOf(req, companyId);
        const visible = await visibleProjectIdsFor(companyId, caller);
        if (visible && !visible.includes(String(run.projectId || ''))) return fail(res, 'Run not found.', 404);
        const auditRows = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AUDIT_LOGS, data: [{ 'meta.runId': String(run._id) }, {}, { sort: { createdAt: 1 }, limit: 200 }] }, 'find').catch(() => []);
        const plain = typeof run.toObject === 'function' ? run.toObject() : { ...run };
        const pinned = await revisions.forRun(companyId, plain);
        plain.agentRevision = Number(pinned.n);
        plain.skillRevision = plain.skillRevision || null;
        plain.traceId = plain.traceId || null;
        plain.steps = Array.isArray(plain.steps) ? plain.steps : [];
        const { actor } = caller;
        const ctx = await undo.undoContext(companyId, actor, { run: plain, ...(visible ? { visibleProjectIds: visible } : {}) });
        const check = await revert.revertCheck(companyId, plain, { actor, isPrivileged: caller.privileged, ...ctx });
        if (plain.finishedAt && !plain.revertedAt) plain.windowEndsAt = new Date(check.undoUntil);
        Object.assign(plain, { undoUntil: check.undoUntil, undoable: Boolean(check.ok), undoReason: check.reason || '' });
        const audit = [];
        for (const row of auditRows || []) {
            const o = typeof row.toObject === 'function' ? row.toObject() : { ...row };
            // eslint-disable-next-line no-await-in-loop
            const state = o.action === agentAudit.ACTION_DONE ? await undo.undoStateOf(companyId, o, actor, ctx) : null;
            audit.push(state ? { ...o, undoUntil: state.undoUntil, undoable: state.undoable, undoReason: state.reason } : o);
        }
        const revision = { n: Number(pinned.n), state: pinned.state, synthetic: Boolean(pinned.synthetic), missing: Boolean(pinned.missing), createdAt: pinned.createdAt || null, createdBy: pinned.createdBy || null, serves: pinned.serves || [], skillRefs: pinned.skillRefs || [] };
        const [firstReplay] = await replaysOf(companyId, run._id, { _id: 1 }, 1).catch(() => []);
        if (firstReplay) plain.replayId = String(firstReplay._id);
        return res.send({ status: true, statusText: 'Run fetched.', data: { run: plain, audit, revision, trace: buildTrace(plain, audit) } });
    } catch (e) { logger.error(`getRun: ${e.message}`); return fail(res, e.message, 500); }
};

const REPLAY_LIMIT = 200;
const replaysOf = async (companyId, runId, fields, limit) => (await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AI_REPLAYS, data: [{ runId: String(runId) }, fields, { sort: { createdAt: 1 }, limit }] }, 'find')) || [];

/* GET /api/v2/agents/runs/:id/replay — owner/admin only: the records hold the prompts and raw responses */
exports.getRunReplay = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !req.uid) return fail(res, 'Unauthorized.', 401);
        if (!canManageAgents(await callerOf(req, companyId))) return fail(res, 'Owner/admin only.', 403);
        if (!OBJECT_ID.test(req.params.id)) return fail(res, 'A valid run id is required.', 400);
        const run = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_RUNS, data: [{ _id: oid(req.params.id) }] }, 'findOne');
        if (!run) return fail(res, 'Run not found.', 404);
        return res.send({ status: true, statusText: 'Replay fetched.', data: await replaysOf(companyId, run._id, {}, REPLAY_LIMIT) });
    } catch (e) { logger.error(`getRunReplay: ${e.message}`); return fail(res, e.message, 500); }
};

/* POST /api/v2/agents/runs  body: { agentId, taskId, skill?, trigger?, note?, spendCapUsd?, notifyMe?, idempotencyKey? }
 * An Idempotency-Key header (or body field) makes a retry return the run the
 * first request started; without one, a second start while a run for the same
 * agent and task is open returns that run. Either way data.deduplicated says so. */
exports.startRun = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const { actor, human } = await humanActor(req);
        const { agentId, taskId, skill, trigger, note, notifyMe } = req.body || {};
        if (!companyId || !OBJECT_ID.test(String(agentId || ''))) return fail(res, 'companyId and a valid agentId are required.');
        const spendCapUsd = runSpendCapOf((req.body || {}).spendCapUsd);
        const idempotencyKey = idempotencyKeyOf(req);
        const agent = await runs.getAgent(companyId, agentId);
        const check = await runs.canStart(agent, { trigger: trigger || 'manual', viaAccount: isAgent(actor) ? actor.viaAccount : undefined, companyId });
        if (!check.ok) return fail(res, check.reason, 409);
        if (!human && !isAgent(actor)) return fail(res, 'Unauthorized.', 401);
        let task = null;
        if (taskId) {
            task = await tools.getTask(companyId, taskId).catch(() => null);
            if (!task) return fail(res, 'Task not found.', 404);
            if (agent.projectIds && agent.projectIds.length && !agent.projectIds.includes(String(task.ProjectID))) return fail(res, 'This agent is not scoped to that project.', 403);
        }
        if (!task) {
            // Every executable skill works on a task. Without one the run used to be created,
            // never executed and never finished — "running" forever in every counter.
            return fail(res, 'This agent needs a task to run on. Start the run from a task, or mention the agent in a comment.');
        }
        const { run, deduplicated } = await runs.start(companyId, { agent, taskId, projectId: task && task.ProjectID, skill: runs.skillSlugOf(agent, skill), trigger: TRIGGERS.includes(trigger) ? trigger : 'manual', startedBy: actor.userId, viaAccount: isAgent(actor) ? actor.viaAccount : agent.account, note, spendCapUsd, notifyMe: Boolean(notifyMe), idempotencyKey });
        const plain = typeof run.toObject === 'function' ? run.toObject() : { ...run };
        if (deduplicated) return res.send({ status: true, statusText: 'Run already started.', data: { ...plain, deduplicated: true } });
        if (task && registry.has('subtask.create')) {
            const runActor = { kind: 'agent', userId: actor.userId, agentId: String(agent._id), agentName: agent.name, runId: String(run._id), viaAccount: run.viaAccount, tokenId: null };
            setImmediate(() => runs.executeSkill(companyId, run, agent, task, { proposals, actions, actor: runActor }));
        }
        return res.send({ status: true, statusText: 'Run started.', data: { ...plain, deduplicated: false } });
    } catch (e) { logger.error(`startRun: ${e.message}`); return fail(res, e.message, e.status || 500); }
};

/* POST /api/v2/agents/runs/:id/stop — owner/admin or the run's starter. Permission is
 * checked before the run's state, so a finished run tells a stranger nothing. */
exports.stopRun = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !OBJECT_ID.test(req.params.id)) return fail(res, 'companyId and a valid run id are required.');
        const caller = await callerOf(req, companyId);
        if (!caller.human) return fail(res, 'Agents cannot stop runs.', 403);
        const run = await runs.get(companyId, req.params.id);
        if (!run) return fail(res, 'Run not found.', 404);
        if (!canControlRun(caller, run)) return fail(res, REFUSAL.CONTROL_RUN, 403);
        const out = await runs.stop(companyId, req.params.id, req.uid);
        if (out.error) return fail(res, out.error, out.status || 409);
        return res.send({ status: true, statusText: 'Run stopped.', data: out.run });
    } catch (e) { logger.error(`stopRun: ${e.message}`); return fail(res, e.message, 500); }
};

/* POST /api/v2/agents/runs/:id/revert — owner/admin or the run's starter */
exports.revertRun = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !OBJECT_ID.test(req.params.id)) return fail(res, 'companyId and a valid run id are required.');
        const caller = await callerOf(req, companyId);
        if (!caller.human) return fail(res, 'Agents cannot revert runs.', 403);
        const out = await revert.revertRun(companyId, req.params.id, { actor: caller.actor, isPrivileged: caller.privileged, ip: req.ip || '' });
        if (out.error) return fail(res, out.error, out.status || 400, refusalOf(out));
        return res.send({ status: true, statusText: 'Run reverted.', data: out });
    } catch (e) { logger.error(`revertRun: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET / PUT /api/v2/agents/settings — undo window, monthly budget, provider (read-only) */
exports.getSettings = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        return res.send({ status: true, statusText: 'Settings fetched.', data: { ...(await budget.settings(companyId)), provider: budget.provider() } });
    } catch (e) { logger.error(`getSettings: ${e.message}`); return fail(res, e.message, 500); }
};

exports.putSettings = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !req.uid) return fail(res, 'Unauthorized.', 401);
        if (!canManageAgents(await callerOf(req, companyId))) return fail(res, 'Owner/admin only.', 403);
        const out = await budget.updateSettings(companyId, req.body || {});
        if (out.error) return fail(res, out.error, out.status || 400);
        return res.send({ status: true, statusText: 'Settings updated.', data: { ...out.settings, provider: budget.provider() } });
    } catch (e) { logger.error(`putSettings: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET /api/v2/agents/budget — this month's company spend against the budget */
exports.getBudget = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        return res.send({ status: true, statusText: 'Budget fetched.', data: await budget.status(companyId) });
    } catch (e) { logger.error(`getBudget: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET /api/v2/agents/models — the priced allowlist a pin may name */
exports.getModels = (req, res) => {
    const configuredOnly = String((req.query && req.query.configured) || '') === 'true';
    const models = modelPin.allowlist({ configuredOnly });
    return res.send({ status: true, statusText: 'Models fetched.', data: { models, taskClasses: taskClass.list() } });
};

/* GET /api/v2/agents/routing-policy — task class to model preferences for this workspace */
exports.getRoutingPolicy = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        return res.send({ status: true, statusText: 'Routing policy fetched.', data: await routingPolicy.get(companyId) });
    } catch (e) { logger.error(`getRoutingPolicy: ${e.message}`); return fail(res, e.message, 500); }
};

/* PUT /api/v2/agents/routing-policy */
exports.putRoutingPolicy = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !req.uid) return fail(res, 'Unauthorized.', 401);
        const caller = await callerOf(req, companyId);
        if (refuseUnlessManager(res, caller, 'Agents cannot change the routing policy.')) return undefined;
        const out = await routingPolicy.update(companyId, req.body || {}, caller.actor.userId);
        if (out.error) return fail(res, out.error, out.status || 400, out.code ? { code: out.code } : undefined);
        return res.send({ status: true, statusText: 'Routing policy updated.', data: out.policy });
    } catch (e) { logger.error(`putRoutingPolicy: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET /api/v2/agents/proposals?status=pending&bucket=primary|later&agentId= */
exports.listProposals = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        const q = req.query || {};
        const projectIds = await visibleProjectIdsFor(companyId, await callerOf(req, companyId));
        const out = await proposals.list(companyId, { status: q.status === 'all' ? undefined : (q.status || 'pending'), bucket: q.bucket, agentId: q.agentId, limit: q.limit, projectIds });
        return res.send({ status: true, statusText: 'Proposals fetched.', data: out.proposals, counts: out.counts });
    } catch (e) { logger.error(`listProposals: ${e.message}`); return fail(res, e.message, 500); }
};

/* POST /api/v2/agents/proposals — only an agent files one, and only in its own name */
exports.createProposal = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const caller = await callerOf(req, companyId);
        const { actor } = caller;
        const b = req.body || {};
        const agentId = b.agentId || actor.agentId;
        if (!isAgent(actor)) return fail(res, REFUSAL.ACT_AS_AGENT, 403);
        if (!companyId || !OBJECT_ID.test(String(agentId || ''))) return fail(res, 'companyId and a valid agentId are required.');
        if (!canActAsAgent(caller, agentId)) return fail(res, REFUSAL.ACT_AS_AGENT, 403);
        const agent = await runs.getAgent(companyId, agentId);
        if (!agent) return fail(res, 'Agent not found.', 404);
        const saved = await proposals.create(companyId, { agent, runId: b.runId || actor.runId, taskId: b.taskId, projectId: b.projectId, what: b.what, why: b.why, changes: b.changes, gate: b.gate, priority: b.priority, cost: b.cost });
        return res.send({ status: true, statusText: 'Proposal filed.', data: saved });
    } catch (e) { logger.error(`createProposal: ${e.message}`); return fail(res, e.message, e.status || 500); }
};

const decide = (fn) => async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !OBJECT_ID.test(req.params.id)) return fail(res, 'companyId and a valid proposal id are required.');
        const caller = await callerOf(req, companyId);
        if (!caller.human) return fail(res, 'Agents cannot decide proposals — a person has to.', 403);
        const out = await fn(companyId, req.params.id, { decider: caller.actor, isPrivileged: caller.privileged, changes: req.body && req.body.changes, reason: req.body && req.body.reason, ip: req.ip || '' });
        if (out.error) return fail(res, out.error, out.status || 400, refusalOf(out));
        return res.send({ status: true, statusText: 'Done.', data: out });
    } catch (e) { logger.error(`proposal decision: ${e.message}`); return fail(res, e.message, 500); }
};

exports.approveProposal = decide(proposals.approve);
exports.declineProposal = decide(proposals.decline);
exports.undoProposal = decide(proposals.undoApproval);

/* GET / PUT / DELETE /api/v2/agents/account — my personal coding-agent link */
exports.getAccount = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !req.uid) return fail(res, 'Unauthorized.', 401);
        const [account, policy, summary] = await Promise.all([accounts.getAccount(req.uid), accounts.getPolicy(companyId), accounts.monthlySummary(companyId, req.uid, req.query && req.query.month)]);
        return res.send({ status: true, statusText: 'Account fetched.', data: { account, policy, summary } });
    } catch (e) { logger.error(`getAccount: ${e.message}`); return fail(res, e.message, 500); }
};

exports.linkAccount = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const { human } = await humanActor(req);
        if (!companyId || !req.uid) return fail(res, 'Unauthorized.', 401);
        if (!human) return fail(res, 'Agents cannot link accounts.', 403);
        const out = await accounts.link(companyId, req.uid, req.body || {});
        if (out.error) return fail(res, out.error, out.status || 400);
        return res.send({ status: true, statusText: 'Account linked.', data: out.account });
    } catch (e) { logger.error(`linkAccount: ${e.message}`); return fail(res, e.message, 500); }
};

exports.unlinkAccount = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const { human } = await humanActor(req);
        if (!companyId || !req.uid) return fail(res, 'Unauthorized.', 401);
        if (!human) return fail(res, 'Agents cannot unlink accounts.', 403);
        return res.send({ status: true, statusText: 'Account unlinked. Past comments, PRs and hours stay on their tasks.', data: await accounts.unlink(companyId, req.uid) });
    } catch (e) { logger.error(`unlinkAccount: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET / PUT /api/v2/agents/policy — owner/admin */
exports.getPolicy = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        return res.send({ status: true, statusText: 'Policy fetched.', data: await accounts.getPolicy(companyId) });
    } catch (e) { return fail(res, e.message, 500); }
};

exports.setPolicy = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !req.uid) return fail(res, 'Unauthorized.', 401);
        if (!canManageAgents(await callerOf(req, companyId))) return fail(res, 'Owner/admin only.', 403);
        const out = await accounts.setPolicy(companyId, req.body || {});
        if (out.error) return fail(res, out.error, out.status || 400);
        return res.send({ status: true, statusText: 'Policy updated.', data: out.policy });
    } catch (e) { logger.error(`setPolicy: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET /api/v2/agents/team — the Team board (13h): people and agents, what each
 * is on right now, load for the week, PTO, and a composed standup. */
exports.teamBoard = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        const hoursPerWeek = Number(req.query && req.query.hoursPerWeek) > 0 ? Number(req.query.hoursPerWeek) : 40;
        const data = await team.board(companyId, { hoursPerWeek });
        return res.send({ status: true, statusText: 'Team board fetched.', data: { ...data, standup: team.standup(data) } });
    } catch (e) { logger.error(`teamBoard: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET /api/v2/agents/routable?projectId=&limit= — open tasks the caller can
 * already see, for the bulk router (30b). Scoped through Agents/scope so routing
 * can never surface a task the person could not open on their own. */
exports.routableTasks = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !req.uid) return fail(res, 'Unauthorized.', 401);
        const ids = await scope.visibleProjectIds(companyId, req.uid);
        if (!ids.length) return res.send({ status: true, statusText: 'Routable tasks fetched.', data: [] });
        const q = req.query || {};
        const wanted = q.projectId && ids.includes(String(q.projectId)) ? [String(q.projectId)] : ids;
        const limit = Math.min(100, Math.max(1, Number(q.limit) || 40));
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ deletedStatusKey: { $ne: 1 }, ProjectID: { $in: wanted }, statusType: { $nin: ['close', 'done', 'default_close'] } },
                   'TaskName TaskKey status statusType Task_Priority ProjectID tagsArray AssigneeUserId totalEstimatedTime updatedAt links description rawDescription',
                   { sort: { updatedAt: -1 }, limit }],
        }, 'find').catch(() => []);
        // The router needs to know what each task carries (PR link, public URL,
        // brief length) — not the body itself, which can be long.
        const data = (rows || []).map((t) => {
            const o = typeof t.toObject === 'function' ? t.toObject() : { ...t };
            const inputs = inputsOf(o);
            delete o.description; delete o.rawDescription; delete o.links;
            return { ...o, inputs };
        });
        return res.send({ status: true, statusText: 'Routable tasks fetched.', data });
    } catch (e) { logger.error(`routableTasks: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET /api/v2/agents/pipeline — tasks an agent has worked on (28a task picker). */
exports.pipelineTasks = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !req.uid) return fail(res, 'Unauthorized.', 401);
        const data = await shipping.pipelineTasks(companyId, req.uid, { limit: req.query && req.query.limit });
        return res.send({ status: true, statusText: 'Pipeline fetched.', data });
    } catch (e) { logger.error(`pipelineTasks: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET /api/v2/agents/release?since= — the release candidate (28c). */
exports.releaseCandidate = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !req.uid) return fail(res, 'Unauthorized.', 401);
        const data = await shipping.releaseCandidate(companyId, req.uid, { since: req.query && req.query.since });
        return res.send({ status: true, statusText: 'Release candidate fetched.', data });
    } catch (e) { logger.error(`releaseCandidate: ${e.message}`); return fail(res, e.message, 500); }
};

exports.normaliseSkill = normaliseSkill;

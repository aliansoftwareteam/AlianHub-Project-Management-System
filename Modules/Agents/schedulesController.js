const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const runs = require('./runs');
const { callerOf, canManageAgents } = require('./access');
const slots = require('./schedules/slots');
const reports = require('./schedules/reports');
const delivery = require('./schedules/delivery');
const { ownerMayRun, taskScopeFor, ownerSeesTask, ownerSeesProject } = require('./schedules/ownerAccess');

// Schedules on an agent and the reports they deliver. Owners and admins manage
// any agent's schedules; the agent's own owner manages the ones on their agent.
// Anyone else sees only the schedules that run as them. A report is readable by
// the person it was delivered to.

const companyOf = (req) => String(req.headers['companyid'] || '');
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const L3 = 3;
const MAX_PER_AGENT = 20;
const REPORT_LIST_MAX = 50;
const REPORT_FIELDS = 'agentId agentName skill trigger kind status startedBy startedAt finishedAt slotAt scheduleId outcome report spend';
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };
const fail = (res, statusText, code) => res.status(code || 400).send({ status: false, statusText, message: statusText });
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : { ...doc });

const REFUSAL = Object.freeze({
    NEEDS_L3: 'Only an agent at L3 (acts, also on a schedule) can run on a schedule. Raise its autonomy to L3 first.',
    MANAGE: 'Only an Owner, an Admin or the agent\'s owner can change its schedules.',
    HUMAN: 'Agents cannot manage schedules.',
    OWNER: 'Only an Owner or an Admin can make a schedule run as someone else.',
});

const invalid = (message) => Object.assign(new Error(message), { status: 400 });

const bool = (value) => value === true || value === 'true';

/* Only the fields a schedule stores, each checked; a partial body on update keeps the rest. */
const fieldsOf = (body, before = {}) => {
    const set = {};
    const merged = { ...before };
    if (body.report !== undefined) {
        if (!reports.REPORT_KEYS.includes(body.report)) throw invalid(`report must be one of ${reports.REPORT_KEYS.join(', ')}`);
        set.report = body.report;
    }
    ['every', 'at', 'timezone'].forEach((key) => { if (body[key] !== undefined) set[key] = String(body[key]).trim(); });
    if (body.weekday !== undefined && body.weekday !== null && body.weekday !== '') set.weekday = Number(body.weekday);
    Object.assign(merged, set);
    if (merged.every !== 'weekly') {
        delete merged.weekday;
        delete set.weekday;
        if (before.weekday !== undefined && before.weekday !== null) set.weekday = null;
    }
    const errors = slots.validate(merged);
    if (errors.length) throw invalid(errors.join('; '));
    if (body.options !== undefined) {
        const days = body.options && body.options.days;
        if (days !== undefined && days !== null && !(Number.isInteger(Number(days)) && Number(days) >= 1 && Number(days) <= reports.MAX_DAYS)) {
            throw invalid(`options.days must be 1 to ${reports.MAX_DAYS}`);
        }
        set.options = days === undefined || days === null ? {} : { days: Number(days) };
    }
    if (body.deliver !== undefined) {
        const d = body.deliver || {};
        const taskId = d.taskId ? String(d.taskId) : '';
        const pageProjectId = d.pageProjectId ? String(d.pageProjectId) : '';
        if ((taskId && !OBJECT_ID.test(taskId)) || (pageProjectId && !OBJECT_ID.test(pageProjectId))) throw invalid('deliver.taskId and deliver.pageProjectId must be ids');
        set.deliver = { email: bool(d.email), ...(taskId ? { taskId } : {}), ...(pageProjectId ? { pageProjectId } : {}) };
    }
    if (body.enabled !== undefined) set.enabled = bool(body.enabled);
    return set;
};

const mayManage = (caller, agent) => caller.human && (canManageAgents(caller) || String(agent.ownerId || '') === String(caller.actor.userId));

const agentOf = async (companyId, id) => (OBJECT_ID.test(String(id || '')) ? runs.getAgent(companyId, id) : null);

const scheduleOf = (companyId, agentId, scheduleId) => (OBJECT_ID.test(String(scheduleId || ''))
    ? MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_SCHEDULES, data: [{ _id: oid(scheduleId), agentId: String(agentId), deletedStatusKey: { $ne: 1 } }] }, 'findOne')
    : null);

/* The owner, then any task or page target, must be something that person may use. */
const refuseTargets = async (companyId, agent, row) => {
    const owner = await ownerMayRun(companyId, agent, row.ownerId);
    if (!owner.ok) return owner.reason;
    const wants = row.deliver || {};
    if (!wants.taskId && !wants.pageProjectId) return null;
    const scope = await taskScopeFor(companyId, row.ownerId, agent);
    if (wants.taskId && !(await ownerSeesTask(companyId, scope, wants.taskId))) return 'The schedule\'s owner cannot open that task.';
    if (wants.pageProjectId && !(await ownerSeesProject(companyId, scope, wants.pageProjectId))) return 'The schedule\'s owner cannot open that project.';
    return null;
};

const shaped = (agent, row, now = new Date()) => {
    const s = plain(row);
    const wants = s.deliver || {};
    return {
        ...s,
        _id: String(s._id),
        nextRunAt: s.enabled === false ? null : slots.nextSlot(s, now),
        writes: { comment: Boolean(wants.taskId) && delivery.mayWrite(agent, 'task.comment'), page: Boolean(wants.pageProjectId) && delivery.mayWrite(agent, 'page.draft') },
        mailConfigured: delivery.mailConfigured(),
    };
};

/* GET /api/v2/agents/:id/schedules */
exports.listSchedules = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const agent = await agentOf(companyId, req.params.id);
        if (!companyId || !agent) return fail(res, 'Agent not found.', 404);
        const caller = await callerOf(req, companyId);
        if (!caller.human) return fail(res, REFUSAL.HUMAN, 403);
        const filter = { agentId: String(agent._id), deletedStatusKey: { $ne: 1 }, ...(mayManage(caller, agent) ? {} : { ownerId: String(caller.actor.userId) }) };
        const rows = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_SCHEDULES, data: [filter, {}, { sort: { createdAt: 1 } }] }, 'find');
        return res.send({ status: true, statusText: 'Schedules fetched.', data: (rows || []).map((row) => shaped(agent, row)) });
    } catch (e) { logger.error(`listSchedules: ${e.message}`); return fail(res, e.message, 500); }
};

/* POST /api/v2/agents/:id/schedules */
exports.createSchedule = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const agent = await agentOf(companyId, req.params.id);
        if (!companyId || !agent) return fail(res, 'Agent not found.', 404);
        const caller = await callerOf(req, companyId);
        if (!caller.human) return fail(res, REFUSAL.HUMAN, 403);
        if (!mayManage(caller, agent)) return fail(res, REFUSAL.MANAGE, 403);
        if (Number(agent.autonomy) < L3) return fail(res, REFUSAL.NEEDS_L3, 409);
        const body = req.body || {};
        const set = fieldsOf({ deliver: {}, options: {}, ...body });
        if (!set.report || !set.every || !set.at || !set.timezone) return fail(res, 'report, every, at and timezone are required.');
        const ownerId = body.ownerId ? String(body.ownerId) : String(caller.actor.userId);
        // Choosing someone else to read as is for owners and admins: an agent's owner could otherwise post an admin's view where they can read it.
        if (ownerId !== String(caller.actor.userId) && !canManageAgents(caller)) return fail(res, REFUSAL.OWNER, 403);
        const count = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_SCHEDULES, data: [{ agentId: String(agent._id), deletedStatusKey: { $ne: 1 } }] }, 'countDocuments');
        if (Number(count) >= MAX_PER_AGENT) return fail(res, `An agent can have at most ${MAX_PER_AGENT} schedules.`, 409);
        const now = new Date();
        const row = { enabled: true, ...set, agentId: String(agent._id), ownerId, createdBy: String(caller.actor.userId), since: now, deletedStatusKey: 0 };
        const refused = await refuseTargets(companyId, agent, row);
        if (refused) return fail(res, refused);
        row.nextRunAt = row.enabled ? slots.nextSlot(row, now) : null;
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_SCHEDULES, data: row }, 'save');
        runs.emitAgent(companyId, { agentId: String(agent._id), schedules: true });
        return res.send({ status: true, statusText: 'Schedule saved.', data: shaped(agent, saved, now) });
    } catch (e) { logger.error(`createSchedule: ${e.message}`); return fail(res, e.message, e.status || 500); }
};

const TIMING = ['every', 'at', 'timezone', 'weekday', 'enabled'];

/* PUT /api/v2/agents/:id/schedules/:scheduleId */
exports.updateSchedule = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const agent = await agentOf(companyId, req.params.id);
        const before = agent ? await scheduleOf(companyId, agent._id, req.params.scheduleId) : null;
        if (!companyId || !agent || !before) return fail(res, 'Schedule not found.', 404);
        const caller = await callerOf(req, companyId);
        if (!caller.human) return fail(res, REFUSAL.HUMAN, 403);
        const own = String(before.ownerId) === String(caller.actor.userId);
        if (!mayManage(caller, agent) && !own) return fail(res, 'Schedule not found.', 404);
        const body = req.body || {};
        const set = fieldsOf(body, plain(before));
        if (body.ownerId !== undefined && String(body.ownerId) !== String(before.ownerId)) {
            if (!canManageAgents(caller)) return fail(res, REFUSAL.OWNER, 403);
            set.ownerId = String(body.ownerId);
        }
        if (!Object.keys(set).length) return fail(res, 'Nothing to update.');
        const next = { ...plain(before), ...set };
        if (next.enabled && Number(agent.autonomy) < L3) return fail(res, REFUSAL.NEEDS_L3, 409);
        const refused = await refuseTargets(companyId, agent, next);
        if (refused) return fail(res, refused);
        const now = new Date();
        if (TIMING.some((key) => key in set)) set.since = now;
        set.nextRunAt = next.enabled ? slots.nextSlot(next, now) : null;
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENT_SCHEDULES, data: [{ _id: before._id }, { $set: set }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        runs.emitAgent(companyId, { agentId: String(agent._id), schedules: true });
        return res.send({ status: true, statusText: 'Schedule saved.', data: shaped(agent, updated, now) });
    } catch (e) { logger.error(`updateSchedule: ${e.message}`); return fail(res, e.message, e.status || 500); }
};

/* DELETE /api/v2/agents/:id/schedules/:scheduleId */
exports.deleteSchedule = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const agent = await agentOf(companyId, req.params.id);
        const before = agent ? await scheduleOf(companyId, agent._id, req.params.scheduleId) : null;
        if (!companyId || !agent || !before) return fail(res, 'Schedule not found.', 404);
        const caller = await callerOf(req, companyId);
        if (!caller.human) return fail(res, REFUSAL.HUMAN, 403);
        if (!mayManage(caller, agent) && String(before.ownerId) !== String(caller.actor.userId)) return fail(res, 'Schedule not found.', 404);
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENT_SCHEDULES, data: [{ _id: before._id }, { $set: { deletedStatusKey: 1, enabled: false, nextRunAt: null } }],
        }, 'updateOne');
        runs.emitAgent(companyId, { agentId: String(agent._id), schedules: true });
        return res.send({ status: true, statusText: 'Schedule removed.', data: { _id: String(before._id) } });
    } catch (e) { logger.error(`deleteSchedule: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET /api/v2/agents/reports — the reports delivered to the caller, newest first. */
exports.listReports = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        const caller = await callerOf(req, companyId);
        if (!caller.human) return fail(res, REFUSAL.HUMAN, 403);
        const limit = Math.min(REPORT_LIST_MAX, Math.max(1, Number((req.query || {}).limit) || 20));
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENT_RUNS, data: [{ kind: 'report', startedBy: String(caller.actor.userId) }, REPORT_FIELDS, { sort: { startedAt: -1 }, limit }],
        }, 'find');
        return res.send({ status: true, statusText: 'Reports fetched.', data: (rows || []).map(plain) });
    } catch (e) { logger.error(`listReports: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET /api/v2/agents/reports/:id */
exports.getReport = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !OBJECT_ID.test(String(req.params.id || ''))) return fail(res, 'Report not found.', 404);
        const caller = await callerOf(req, companyId);
        if (!caller.human) return fail(res, REFUSAL.HUMAN, 403);
        const row = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENT_RUNS, data: [{ _id: oid(req.params.id), kind: 'report', startedBy: String(caller.actor.userId) }, REPORT_FIELDS],
        }, 'findOne');
        if (!row) return fail(res, 'Report not found.', 404);
        return res.send({ status: true, statusText: 'Report fetched.', data: plain(row) });
    } catch (e) { logger.error(`getReport: ${e.message}`); return fail(res, e.message, 500); }
};

exports.REFUSAL = REFUSAL;

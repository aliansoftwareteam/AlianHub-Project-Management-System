const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const audit = require('./agentAudit');
const undo = require('./undo');
const runs = require('./runs');
const budget = require('./budget');
const scope = require('./scope');
const memory = require('./memory');
const logger = require('../../Config/loggerConfig');

// Whole-run revert: every audited action of a finished run, newest first,
// through the same inverse a proposal undo uses, inside the company's undo
// window. One failure does not stop the rest; each is reported.

const HOUR_MS = 60 * 60 * 1000;
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

const actionRows = (companyId, runId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.AUDIT_LOGS, data: [{ 'meta.runId': String(runId), action: audit.ACTION_DONE }, {}, { sort: { createdAt: 1 }, limit: 500 }],
}, 'find');

const windowEnd = (run, undoHours) => new Date(new Date(run.finishedAt).getTime() + undoHours * HOUR_MS);

const REASON = Object.freeze({ ...undo.REASON, NOT_PERMITTED: 'not_permitted', RUN_OPEN: 'run_open', ALREADY_REVERTED: 'already_reverted' });

/* Whether this caller may revert this run right now. Resolves { ok, undoUntil, ctx }
 * or { error, status, reason, undoUntil }; getRun reads the same answer so the
 * client renders the deadline the server will enforce. */
const revertCheck = async (companyId, run, { actor, isPrivileged, visibleProjectIds, undoHours }) => {
    const settings = undoHours !== undefined ? { undoHours } : await budget.settings(companyId);
    const undoUntil = run.finishedAt ? windowEnd(run, settings.undoHours).toISOString() : null;
    const refusal = (error, status, reason) => ({ error, status, reason, undoUntil });
    const visible = visibleProjectIds || (await scope.visibleProjectIds(companyId, actor.userId)).map(String);
    if (run.projectId && !visible.includes(String(run.projectId))) return refusal('You cannot see the project this run worked in.', 403, REASON.NOT_VISIBLE);
    if (!isPrivileged && String(run.startedBy || '') !== String(actor.userId)) return refusal('Only an Owner, an Admin or the person who started the run can revert it.', 403, REASON.NOT_PERMITTED);
    if (run.revertedAt) return refusal(`Run was already reverted at ${new Date(run.revertedAt).toISOString()}.`, 409, REASON.ALREADY_REVERTED);
    if (runs.OPEN.includes(run.status) || !run.finishedAt) return refusal(`Run is still ${run.status} — stop it first.`, 409, REASON.RUN_OPEN);
    if (Date.now() >= new Date(undoUntil).getTime()) {
        return refusal(`The revert window closed at ${undoUntil} (${settings.undoHours} h after the run finished).`, 409, REASON.WINDOW_PASSED);
    }
    return { ok: true, undoUntil, ctx: { run, undoHours: settings.undoHours, visibleProjectIds: visible } };
};

const revertRun = async (companyId, runId, { actor, isPrivileged, ip }) => {
    const run = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_RUNS, data: [{ _id: oid(runId) }] }, 'findOne');
    if (!run) return { error: 'Run not found.', status: 404 };
    const check = await revertCheck(companyId, run, { actor, isPrivileged });
    if (check.error) {
        if (check.reason === REASON.WINDOW_PASSED || check.reason === REASON.NOT_VISIBLE) {
            await audit.recordRefusal(companyId, actor, { action: 'run.revert', reason: check.reason, params: { undoUntil: check.undoUntil }, entityType: 'agent_run', entityId: String(run._id), path: '', ip });
        }
        return check;
    }
    const windowEndsAt = new Date(check.undoUntil);

    const rows = ((await actionRows(companyId, run._id)) || []).filter((r) => !(r.meta && r.meta.state === audit.STATE.FAILED));
    const pending = rows.filter((r) => !(r.meta && r.meta.undoneAt));
    if (!rows.length) return { error: 'This run made no reversible changes.', status: 409 };

    const failed = [];
    let reverted = 0;
    for (const row of [...pending].reverse()) {
        // eslint-disable-next-line no-await-in-loop
        const out = await undo.undoAuditRow(companyId, row, actor, ip, check.ctx).catch((e) => ({ ok: false, reason: e.message }));
        if (out.ok) reverted += 1;
        else failed.push({ action: row.meta && row.meta.action, auditId: String(row._id), reason: out.message || out.reason });
    }

    const result = { reverted, alreadyUndone: rows.length - pending.length, failed, windowEndsAt, undoUntil: check.undoUntil };
    await runs.patch(companyId, run._id, { revertedAt: new Date(), revertedBy: String(actor.userId), revert: { reverted, failed }, 'episode.reverted': true });
    await audit.recordRunReverted(companyId, actor, { runId: String(run._id), agentId: run.agentId, agentName: run.agentName, reverted, failed, ip });
    try { await memory.recordEpisode({ companyId, projectId: String(run.projectId || ''), runId: String(run._id), patch: { reverted: true } }); }
    catch (e) { logger.error(`[agent-revert] ${run._id}: episode not updated: ${e.message}`); }
    return result;
};

module.exports = { revertRun, revertCheck, windowEnd, REASON };

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const audit = require('./agentAudit');
const undo = require('./undo');
const runs = require('./runs');
const budget = require('./budget');

// Whole-run revert: every audited action of a finished run, newest first,
// through the same inverse a proposal undo uses, inside the company's undo
// window. One failure does not stop the rest; each is reported.

const HOUR_MS = 60 * 60 * 1000;
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

const actionRows = (companyId, runId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.AUDIT_LOGS, data: [{ 'meta.runId': String(runId), action: audit.ACTION_DONE }, {}, { sort: { createdAt: 1 }, limit: 500 }],
}, 'find');

const windowEnd = (run, undoHours) => new Date(new Date(run.finishedAt).getTime() + undoHours * HOUR_MS);

const revertRun = async (companyId, runId, { actor, isPrivileged, ip }) => {
    const run = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_RUNS, data: [{ _id: oid(runId) }] }, 'findOne');
    if (!run) return { error: 'Run not found.', status: 404 };
    if (!isPrivileged && String(run.startedBy || '') !== String(actor.userId)) return { error: 'Only an Owner, an Admin or the person who started the run can revert it.', status: 403 };
    if (run.revertedAt) return { error: `Run was already reverted at ${new Date(run.revertedAt).toISOString()}.`, status: 409 };
    if (runs.OPEN.includes(run.status) || !run.finishedAt) return { error: `Run is still ${run.status} — stop it first.`, status: 409 };

    const { undoHours } = await budget.settings(companyId);
    const windowEndsAt = windowEnd(run, undoHours);
    if (Date.now() >= windowEndsAt.getTime()) {
        return { error: `The revert window closed at ${windowEndsAt.toISOString()} (${undoHours} h after the run finished).`, status: 409 };
    }

    const rows = (await actionRows(companyId, run._id)) || [];
    const pending = rows.filter((r) => !(r.meta && r.meta.undoneAt));
    if (!rows.length) return { error: 'This run made no reversible changes.', status: 409 };

    const failed = [];
    let reverted = 0;
    for (const row of [...pending].reverse()) {
        // eslint-disable-next-line no-await-in-loop
        const out = await undo.undoAuditRow(companyId, row, actor, ip).catch((e) => ({ ok: false, reason: e.message }));
        if (out.ok) reverted += 1;
        else failed.push({ action: row.meta && row.meta.action, auditId: String(row._id), reason: out.reason });
    }

    const result = { reverted, alreadyUndone: rows.length - pending.length, failed, windowEndsAt };
    await runs.patch(companyId, run._id, { revertedAt: new Date(), revertedBy: String(actor.userId), revert: { reverted, failed } });
    await audit.recordRunReverted(companyId, actor, { runId: String(run._id), agentId: run.agentId, agentName: run.agentName, reverted, failed, ip });
    return result;
};

module.exports = { revertRun, windowEnd };

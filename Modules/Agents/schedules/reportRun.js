const logger = require('../../../Config/loggerConfig');
const { askModel } = require('../../AICore/modelCall');
const { FEATURES } = require('../../AICore/features');
const runs = require('../runs');
const spendGuard = require('../spendGuard');
const reports = require('./reports');
const delivery = require('./delivery');
const { tzOffsetAt } = require('./slots');
const { ownerMayRun, taskScopeFor } = require('./ownerAccess');

// One scheduled report: a task-less run of kind `report`, recorded in the normal
// run history with trigger `schedule` and started as the schedule's owner. The
// facts are read deterministically; one model call writes the summary above them
// and is priced and capped like any agent call. No model, no summary: the facts
// still go out.

const TRIGGER = 'schedule';
const KIND = 'report';
const LOG_PREFIX = '[agent-schedule]';
const SUMMARY_MAX = 1200;
const SUMMARY_SKILL = Object.freeze({
    systemPrompt: [
        'You write the two-to-four sentence summary at the top of a scheduled work report.',
        'Use only the facts in the report JSON. Name the most urgent items first. Do not invent tasks, dates or people.',
        'Answer with JSON: {"summary": "..."}',
    ].join(' '),
    maxTokens: 400,
});

const slotKey = (agent, schedule, slot) => `${agent._id}:schedule:${schedule._id}:${new Date(slot).toISOString()}`;

const summarise = async (companyId, { run, agent, report }) => {
    const guard = spendGuard.forRun({ companyId, run });
    const spend = { feature: FEATURES.AGENT_RUN, companyId, runId: String(run._id), userId: run.startedBy || null, account: run.viaAccount || 'workspace', agentId: String(agent._id), agentRevision: run.agentRevision, skillRevision: run.skillRevision };
    const asked = await askModel(SUMMARY_SKILL, { prompt: reports.promptOf(report), budget: { maxTokens: SUMMARY_SKILL.maxTokens, guard }, spend, agent });
    const booked = await runs.recordSpend(companyId, run, asked.usage, asked.model);
    const text = asked.raw && typeof asked.raw.summary === 'string' ? asked.raw.summary.trim().slice(0, SUMMARY_MAX) : '';
    return { summary: text, note: text ? null : (asked.refused ? asked.refused.reason : asked.degraded), capReached: Boolean(booked && booked.capReached) };
};

/* Returns { status, reason?, code?, runId? } for the schedule's lastResult. */
const runReport = async (companyId, { agent, schedule, slot, now = new Date() }) => {
    const ownerId = String(schedule.ownerId);
    const owner = await ownerMayRun(companyId, agent, ownerId);
    if (!owner.ok) return { status: 'skipped', reason: owner.reason, code: 'owner_not_allowed' };
    const check = await runs.canStart(agent, { trigger: TRIGGER, companyId, depth: 0 });
    if (!check.ok) return { status: 'skipped', reason: check.reason, ...(check.code ? { code: check.code } : {}) };

    const { run, deduplicated } = await runs.start(companyId, {
        agent, taskId: null, projectId: null, skill: `report.${schedule.report}`, trigger: TRIGGER, startedBy: ownerId,
        viaAccount: agent.account, idempotencyKey: slotKey(agent, schedule, slot), kind: KIND, scheduleId: schedule._id, slotAt: new Date(slot),
    });
    if (deduplicated) return { status: 'deduplicated', runId: String(run._id) };

    try {
        const scope = await taskScopeFor(companyId, ownerId, agent);
        const report = await reports.gather(schedule.report, {
            companyId, ownerId, scope, now, tzOffset: tzOffsetAt(schedule.timezone, now), options: schedule.options || {},
        });
        const { summary, note, capReached } = await summarise(companyId, { run, agent, report });
        const text = reports.textOf(report, { agentName: agent.name, summary });
        const { delivered, notes } = await delivery.deliver(companyId, { run, agent, schedule, report, text, scope });
        const stored = { ...report, summary, text, delivered, notes: [note, ...notes].filter(Boolean) };
        await runs.patch(companyId, run._id, { report: stored });
        const outcome = `${report.title} delivered${capReached ? ' (spend cap reached)' : ''}`;
        await runs.finish(companyId, run._id, { status: runs.STATUS.DONE, outcome, onlyIf: runs.STATUS.RUNNING });
        return { status: 'done', runId: String(run._id) };
    } catch (e) {
        logger.error(`${LOG_PREFIX} run ${run._id}: ${e.message}`);
        await runs.finish(companyId, run._id, { status: runs.STATUS.FAILED, outcome: 'report failed', error: e.message, onlyIf: runs.STATUS.RUNNING }).catch(() => null);
        return { status: 'failed', reason: e.message, runId: String(run._id) };
    }
};

module.exports = { TRIGGER, KIND, runReport, slotKey };

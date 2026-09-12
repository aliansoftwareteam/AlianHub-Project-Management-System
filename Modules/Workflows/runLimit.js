const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const agentAudit = require('../Agents/agentAudit');
const store = require('./store');
const flag = require('./flag');

// The hourly run limit, as the loop's admission control.
//
// The limit was `automationRules.limits.maxRunsPerHour`: written by
// `Automations/helpers/ruleSchemaV2.js` with a default of 500, carried on every
// v2 rule, and read by nothing — defect 17 of the architecture document. It has
// never governed an ordinary agent run; an agent's own limit is
// `rateLimitPerDay` ("Rate limit (actions per day)" in the settings copy), which
// `Agents/runs.canStart` has always enforced. So this gives the hourly field the
// one job its name claims: how many agent runs an hour a repeating workflow may
// start.
//
// Where the number comes from, smallest positive wins, absent or zero meaning
// "no limit at this level" exactly as `rateLimitPerDay` does:
//
//   the loop step's own `maxRunsPerHour` — a definition may ask for less
//   the rule's stored `limits.maxRunsPerHour`, when the run came from a rule
//   WORKFLOW_MAX_RUNS_PER_HOUR, the ceiling for an installation
//
// Counting is per company and per agent over a rolling hour, and it is not a
// query per iteration. One query per agent per cache window reads the start
// times of that agent's runs in the last hour; the window then rolls in memory,
// so the allowance refills as the hour passes without asking again, and every
// iteration this process admits appends its own reservation to the same list.
// A run started elsewhere is picked up at the next reseed, which is why the
// window is short.

const HOUR_MS = 60 * 60 * 1000;
// Reading more start times than any limit could be set to tells us nothing: past
// the cap the answer is "spent" either way.
const MAX_TRACKED = 5000;

const REASON = 'run_limit';

const runStarts = new Map();
const ruleLimits = new Map();

const keyOf = (companyId, id) => `${companyId}:${id}`;

const positive = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0);

const startsSince = async (companyId, agentId, since) => {
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENT_RUNS,
        data: [{ agentId: String(agentId), startedAt: { $gte: since } }, { startedAt: 1 }, { sort: { startedAt: -1 }, limit: MAX_TRACKED }],
    }, 'find');
    return (rows || []).map((row) => new Date(row.startedAt).getTime()).filter((ms) => Number.isFinite(ms));
};

const windowFor = async (companyId, agentId, now) => {
    const key = keyOf(companyId, agentId);
    const cached = runStarts.get(key);
    if (cached && now - cached.seededAt < flag.runLimitCacheMs()) {
        cached.starts = cached.starts.filter((ms) => ms > now - HOUR_MS);
        return cached;
    }
    const fresh = { seededAt: now, starts: await startsSince(companyId, agentId, new Date(now - HOUR_MS)) };
    runStarts.set(key, fresh);
    return fresh;
};

const ruleLimitFor = async (companyId, ruleId, now) => {
    if (!ruleId) return 0;
    const key = keyOf(companyId, ruleId);
    const cached = ruleLimits.get(key);
    if (cached && now - cached.seededAt < flag.runLimitCacheMs()) return cached.limit;
    const rule = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AUTOMATION_RULES, data: [{ _id: String(ruleId) }],
    }, 'findOne').catch(() => null);
    const limit = positive(rule && rule.limits && rule.limits.maxRunsPerHour);
    ruleLimits.set(key, { seededAt: now, limit });
    return limit;
};

/* The effective limit for this loop: the smallest of the ones that are set, and
 * nothing when none of them is. */
const limitFor = async (companyId, run, config = {}, now = Date.now()) => {
    const asked = [positive(config.maxRunsPerHour), await ruleLimitFor(companyId, run && run.ruleId, now), flag.maxRunsPerHour()].filter(Boolean);
    return asked.length ? Math.min(...asked) : 0;
};

/* Has this agent spent the hour's allowance? */
const check = async (companyId, agentId, limit, now = Date.now()) => {
    const cap = positive(limit);
    if (!cap) return { ok: true, agentId: String(agentId), limit: 0, used: 0, resetsAt: null };
    const { starts } = await windowFor(companyId, agentId, now);
    const used = starts.length;
    if (used < cap) return { ok: true, agentId: String(agentId), limit: cap, used, resetsAt: null };
    return { ok: false, agentId: String(agentId), limit: cap, used, resetsAt: new Date(Math.min(...starts) + HOUR_MS) };
};

/* The iteration is going ahead, so the runs it is about to start count against
 * the hour now rather than when their rows appear. */
const reserve = (companyId, agentId, now = Date.now()) => {
    const entry = runStarts.get(keyOf(companyId, agentId));
    if (entry) entry.starts.push(now);
};

/* Admission for one loop iteration: every agent the body would start has to be
 * inside its allowance, and the first one that is not is the reason. */
const admit = async (companyId, run, { agentIds = [], config = {}, now = Date.now() } = {}) => {
    if (!agentIds.length) return { ok: true, limit: 0 };
    const limit = await limitFor(companyId, run, config, now);
    if (!limit) return { ok: true, limit: 0 };
    const verdicts = [];
    for (const agentId of agentIds) {
        // eslint-disable-next-line no-await-in-loop
        const verdict = await check(companyId, agentId, limit, now);
        if (!verdict.ok) return verdict;
        verdicts.push(verdict);
    }
    verdicts.forEach((verdict) => reserve(companyId, verdict.agentId, now));
    return { ok: true, limit, agents: verdicts };
};

const sentence = (verdict) => `Hourly run limit reached (${verdict.used} of ${verdict.limit} in the last hour).`;

/* Why the loop stopped, where a person will look for it: on the run as its
 * blocked reason, and in the audit log as a refusal that named the agent. */
const record = async (companyId, run, step, verdict) => {
    const blocked = {
        reason: REASON,
        stepId: String(step.stepId),
        agentId: verdict.agentId || null,
        limit: verdict.limit,
        used: verdict.used,
        resetsAt: verdict.resetsAt || null,
        detail: sentence(verdict),
        at: new Date(),
    };
    await store.patchRun(companyId, run._id, { blocked });
    await agentAudit.recordRefusal(companyId, require('./engine').stepActor(run), {
        action: `workflow.loop.${REASON}`,
        reason: sentence(verdict),
        entityType: 'workflow_run',
        entityId: String(run._id),
        params: { stepId: String(step.stepId), agentId: verdict.agentId || null, limit: verdict.limit, used: verdict.used, resetsAt: verdict.resetsAt || null },
    });
    return blocked;
};

/* Tests, and a process that has held a window long enough for the agent behind
 * it to have gone. */
const forget = () => { runStarts.clear(); ruleLimits.clear(); };

module.exports = { HOUR_MS, REASON, limitFor, check, reserve, admit, record, sentence, forget };

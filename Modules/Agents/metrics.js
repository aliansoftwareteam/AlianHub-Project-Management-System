const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const agentAudit = require('./agentAudit');
const { REAPED_PREFIX } = require('./proposals');

// Every number is read back from stored rows, never from a process-local counter,
// so several server processes and a restart all report the same figures.

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const WINDOWS = Object.freeze({
    '1h': { ms: HOUR_MS, bucketMs: 5 * MINUTE_MS },
    '24h': { ms: DAY_MS, bucketMs: HOUR_MS },
    '7d': { ms: 7 * DAY_MS, bucketMs: DAY_MS },
    '30d': { ms: 30 * DAY_MS, bucketMs: DAY_MS },
});
const DEFAULT_WINDOW = '24h';
const CACHE_SECONDS = 60;
const DURATION_WINDOW = '24h';
const QUANTILES = [0.5, 0.95];

const RUN_FAILED = 'failed';
const TERMINAL = ['done', 'skipped', 'failed', 'stopped'];
const PROPOSAL_OUTCOMES = ['approved', 'declined', 'undone', 'failed', 'reaped', 'pending'];
const AUTOMATION_FAILED = 'failed';
const UNKNOWN = 'unknown';
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const isWindow = (name) => Object.prototype.hasOwnProperty.call(WINDOWS, name);

const windowOf = (name = DEFAULT_WINDOW, now = new Date()) => {
    if (!isWindow(name)) throw Object.assign(new Error(`window must be one of ${Object.keys(WINDOWS).join(', ')}`), { status: 400 });
    const { ms, bucketMs } = WINDOWS[name];
    const to = new Date(now.getTime());
    return { name, from: new Date(to.getTime() - ms), to, bucketMs, buckets: Math.round(ms / bucketMs) };
};

const time = (v) => (v ? new Date(v).getTime() : NaN);
const money = (n) => Math.round(Number(n || 0) * 10000) / 10000;
const ratio = (part, whole) => (whole > 0 ? part / whole : null);
const numberOr0 = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/* Nearest rank: the smallest observed value with at least q of the sample at or below it. */
const quantile = (values, q) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
};

const durationOf = (row) => {
    const end = time(row.finishedAt);
    const start = time(row.startedAt || row.createdAt);
    return Number.isFinite(end) && Number.isFinite(start) && end >= start ? end - start : null;
};

const outcomeOf = (proposal) => {
    const { status } = proposal;
    if (status === 'approved' || status === 'edited') return 'approved';
    if (status === 'declined' || status === 'undone') return status;
    if (status === 'failed') return String(proposal.failedReason || '').startsWith(REAPED_PREFIX) ? 'reaped' : 'failed';
    return 'pending';
};

const zeroOutcomes = () => Object.fromEntries(PROPOSAL_OUTCOMES.map((o) => [o, 0]));

/* An undone proposal was approved first; failed and reaped ones were never a person's verdict on the work. */
const approvalRates = (outcomes) => {
    const approved = outcomes.approved + outcomes.undone;
    const decided = approved + outcomes.declined;
    return { approvalRate: ratio(approved, decided), declineRate: ratio(outcomes.declined, decided) };
};

const seriesOf = (w) => Array.from({ length: w.buckets }, (_, i) => ({ at: new Date(w.from.getTime() + i * w.bucketMs).toISOString(), runs: 0, failed: 0 }));

const summariseAgents = ({ runs = [], proposals = [], reverts = [] }, w) => {
    const byAgent = new Map();
    const entry = (agentId, agentName) => {
        const key = String(agentId || UNKNOWN);
        if (!byAgent.has(key)) {
            byAgent.set(key, { agentId: key, agentName: '', runs: 0, finished: 0, failed: 0, durations: [], tokens: 0, costUsd: 0, lastRunAt: null, outcomes: zeroOutcomes(), reverted: new Set(), series: seriesOf(w) });
        }
        const a = byAgent.get(key);
        if (agentName && !a.agentName) a.agentName = String(agentName);
        return a;
    };

    runs.forEach((run) => {
        const a = entry(run.agentId, run.agentName);
        const failed = run.status === RUN_FAILED;
        a.runs += 1;
        if (TERMINAL.includes(run.status)) {
            a.finished += 1;
            if (failed) a.failed += 1;
            const ms = durationOf(run);
            if (ms !== null) a.durations.push(ms);
        }
        a.tokens += numberOr0(run.spend && run.spend.tokens);
        a.costUsd += numberOr0(run.spend && run.spend.usd);
        const started = time(run.startedAt || run.createdAt);
        if (Number.isFinite(started)) {
            if (!a.lastRunAt || started > a.lastRunAt) a.lastRunAt = started;
            const bucket = a.series[Math.floor((started - w.from.getTime()) / w.bucketMs)];
            if (bucket) {
                bucket.runs += 1;
                if (failed) bucket.failed += 1;
            }
        }
    });
    proposals.forEach((p) => { entry(p.agentId, p.agentName).outcomes[outcomeOf(p)] += 1; });
    reverts.forEach((r) => { if (r.agentId) entry(r.agentId).reverted.add(String(r.key)); });

    return [...byAgent.values()].map((a) => ({
        agentId: a.agentId,
        agentName: a.agentName,
        runs: a.runs,
        finished: a.finished,
        failed: a.failed,
        errorRate: ratio(a.failed, a.finished),
        p50DurationMs: quantile(a.durations, 0.5),
        p95DurationMs: quantile(a.durations, 0.95),
        proposals: a.outcomes,
        ...approvalRates(a.outcomes),
        reverted: a.reverted.size,
        revertRate: ratio(a.reverted.size, a.runs),
        tokens: a.tokens,
        costUsd: money(a.costUsd),
        lastRunAt: a.lastRunAt ? new Date(a.lastRunAt).toISOString() : null,
        series: a.series,
    })).sort((x, y) => y.runs - x.runs || x.agentId.localeCompare(y.agentId));
};

const summariseModels = ({ usage = [], runs = [] }) => {
    const byModel = new Map();
    const entry = (model) => {
        const key = String(model || UNKNOWN);
        if (!byModel.has(key)) byModel.set(key, { model: key, provider: null, calls: 0, inputTokens: 0, outputTokens: 0, tokens: 0, costUsd: 0, unpricedCalls: 0, finishedRuns: 0, failedRuns: 0 });
        return byModel.get(key);
    };
    usage.forEach((u) => {
        const m = entry(u.model);
        m.calls += 1;
        if (u.provider && !m.provider) m.provider = u.provider;
        m.inputTokens += numberOr0(u.inputTokens);
        m.outputTokens += numberOr0(u.outputTokens);
        m.tokens += numberOr0(u.totalTokens);
        if (typeof u.costUsd === 'number') m.costUsd += u.costUsd;
        else m.unpricedCalls += 1;
    });
    runs.forEach((run) => {
        const model = run.spend && run.spend.model;
        if (!model || !TERMINAL.includes(run.status)) return;
        const m = entry(model);
        m.finishedRuns += 1;
        if (run.status === RUN_FAILED) m.failedRuns += 1;
    });
    return [...byModel.values()]
        .map((m) => ({ ...m, costUsd: money(m.costUsd), errorRate: ratio(m.failedRuns, m.finishedRuns) }))
        .sort((x, y) => y.costUsd - x.costUsd || y.calls - x.calls);
};

const summariseFeatures = ({ usage = [] }) => {
    const byFeature = new Map();
    usage.forEach((u) => {
        const key = String(u.feature || UNKNOWN);
        const f = byFeature.get(key) || { feature: key, calls: 0, tokens: 0, costUsd: 0 };
        f.calls += 1;
        f.tokens += numberOr0(u.totalTokens);
        f.costUsd += numberOr0(u.costUsd);
        byFeature.set(key, f);
    });
    return [...byFeature.values()].map((f) => ({ ...f, costUsd: money(f.costUsd) })).sort((x, y) => y.costUsd - x.costUsd || y.calls - x.calls);
};

const summariseRules = ({ automations = [] }) => {
    const byRule = new Map();
    automations.forEach((run) => {
        const key = String(run.ruleId || UNKNOWN);
        const r = byRule.get(key) || { ruleId: key, ruleName: '', runs: 0, failures: 0, durations: [] };
        r.runs += 1;
        if (run.ruleName && !r.ruleName) r.ruleName = String(run.ruleName);
        if (run.status === AUTOMATION_FAILED) r.failures += 1;
        const ms = durationOf(run);
        if (ms !== null) r.durations.push(ms);
        byRule.set(key, r);
    });
    return [...byRule.values()]
        .map(({ durations, ...r }) => ({ ...r, failureRate: ratio(r.failures, r.runs), p95DurationMs: quantile(durations, 0.95) }))
        .sort((x, y) => y.runs - x.runs);
};

const stepDuration = (step) => (typeof step.durationMs === 'number' ? step.durationMs : durationOf(step));

const summariseSteps = ({ runs = [], automations = [] }) => {
    const bySteps = new Map();
    const add = (source, step) => {
        if (!step || typeof step !== 'object') return;
        const name = String(step.name || step.kind || step.action || step.type || UNKNOWN);
        const key = `${source}:${name}`;
        const s = bySteps.get(key) || { source, step: name, calls: 0, errors: 0, durations: [] };
        s.calls += 1;
        if (step.error || step.status === 'failed') s.errors += 1;
        const ms = stepDuration(step);
        if (ms !== null) s.durations.push(ms);
        bySteps.set(key, s);
    };
    runs.forEach((run) => (Array.isArray(run.steps) ? run.steps : []).forEach((step) => add('agent', step)));
    automations.forEach((run) => (Array.isArray(run.steps) ? run.steps : []).forEach((step) => add('automation', step)));
    return [...bySteps.values()]
        .map(({ durations, ...s }) => ({ ...s, errorRate: ratio(s.errors, s.calls), p95DurationMs: quantile(durations, 0.95) }))
        .sort((x, y) => y.calls - x.calls || x.step.localeCompare(y.step));
};

const summarise = (rows, w) => {
    const agents = summariseAgents(rows, w);
    const outcomes = agents.reduce((sum, a) => { PROPOSAL_OUTCOMES.forEach((o) => { sum[o] += a.proposals[o]; }); return sum; }, zeroOutcomes());
    const total = (field) => agents.reduce((n, a) => n + a[field], 0);
    const usage = rows.usage || [];
    return {
        window: w.name,
        from: w.from.toISOString(),
        to: w.to.toISOString(),
        bucketMs: w.bucketMs,
        totals: {
            runs: total('runs'),
            finished: total('finished'),
            failed: total('failed'),
            errorRate: ratio(total('failed'), total('finished')),
            proposals: outcomes,
            ...approvalRates(outcomes),
            reverted: total('reverted'),
            revertRate: ratio(total('reverted'), total('runs')),
            calls: usage.length,
            tokens: usage.reduce((n, u) => n + numberOr0(u.totalTokens), 0),
            costUsd: money(usage.reduce((n, u) => n + numberOr0(u.costUsd), 0)),
        },
        agents,
        models: summariseModels(rows),
        features: summariseFeatures(rows),
        rules: summariseRules(rows),
        steps: summariseSteps(rows),
    };
};

const since = (field, w) => ({ [field]: { $gte: w.from, $lt: w.to } });
const windowed = (match, fields) => [{ $match: match }, { $project: Object.fromEntries(fields.map((f) => [f, 1])) }];
const aggregate = async (companyId, type, pipeline) => (await MongoDbCrudOpration(companyId, { type, data: [pipeline] }, 'aggregate')) || [];
const revertOf = (row) => ({ agentId: row.meta && row.meta.agentId, key: (row.meta && row.meta.runId) || String(row._id) });

/* An undo row is written by the person who undid, so the agent and run live on the row it undid. */
const undoneOriginals = async (companyId, undoRows) => {
    const ids = [...new Set(undoRows.map((r) => String((r.meta && r.meta.originalAuditId) || '')).filter((id) => OBJECT_ID.test(id)))];
    if (!ids.length) return [];
    const rows = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AUDIT_LOGS, data: [{ _id: { $in: ids } }, 'meta.agentId meta.runId'] }, 'find');
    return (rows || []).map(revertOf);
};

const fetchWindow = async (companyId, w) => {
    const [runs, proposals, usage, revertRows, undoRows, automations] = await Promise.all([
        aggregate(companyId, SCHEMA_TYPE.AGENT_RUNS, windowed(since('startedAt', w), ['agentId', 'agentName', 'status', 'skill', 'startedAt', 'createdAt', 'finishedAt', 'spend', 'steps'])),
        aggregate(companyId, SCHEMA_TYPE.AGENT_PROPOSALS, windowed(since('createdAt', w), ['agentId', 'agentName', 'status', 'failedReason', 'runId'])),
        aggregate(companyId, SCHEMA_TYPE.AI_USAGE, windowed(since('at', w), ['model', 'provider', 'feature', 'inputTokens', 'outputTokens', 'totalTokens', 'costUsd'])),
        aggregate(companyId, SCHEMA_TYPE.AUDIT_LOGS, windowed({ action: agentAudit.RUN_REVERTED, ...since('createdAt', w) }, ['meta.agentId', 'meta.runId'])),
        aggregate(companyId, SCHEMA_TYPE.AUDIT_LOGS, windowed({ action: agentAudit.ACTION_UNDONE, ...since('createdAt', w) }, ['meta.originalAuditId'])),
        aggregate(companyId, SCHEMA_TYPE.AUTOMATION_RUNS, windowed(since('startedAt', w), ['ruleId', 'ruleName', 'status', 'startedAt', 'createdAt', 'finishedAt', 'steps'])),
    ]);
    return { runs, proposals, usage, automations, reverts: [...revertRows.map(revertOf), ...(await undoneOriginals(companyId, undoRows))] };
};

const companyMetrics = async (companyId, windowName = DEFAULT_WINDOW, { now = new Date() } = {}) => {
    if (!companyId) throw Object.assign(new Error('companyId is required'), { status: 400 });
    const w = windowOf(windowName, now);
    return summarise(await fetchWindow(String(companyId), w), w);
};

const cache = () => require('../../Config/config').myCache;

const cached = async (key, compute) => {
    const hit = cache().get(key);
    if (hit !== undefined) return hit;
    const value = await compute();
    cache().set(key, value, CACHE_SECONDS);
    return value;
};

const cachedCompanyMetrics = (companyId, windowName = DEFAULT_WINDOW, opts = {}) => {
    windowOf(windowName);
    return cached(`agentMetrics:${companyId}:${windowName}`, () => companyMetrics(companyId, windowName, opts));
};

const foldProposalGroups = (groups, reaped) => {
    const outcomes = zeroOutcomes();
    groups.forEach((g) => { outcomes[outcomeOf({ status: g._id })] += numberOr0(g.n); });
    const reapedCount = Math.min(numberOr0(reaped), outcomes.failed);
    outcomes.failed -= reapedCount;
    outcomes.reaped += reapedCount;
    return outcomes;
};

/* Lifetime counters over the retained rows (bounded by each collection's TTL), plus the last day's run durations. */
const companyCounters = async (companyId, { now = new Date() } = {}) => {
    const w = windowOf(DURATION_WINDOW, now);
    const [runGroups, usageGroups, proposalGroups, reaped, automationGroups, finished] = await Promise.all([
        aggregate(companyId, SCHEMA_TYPE.AGENT_RUNS, [{ $group: { _id: { agentId: '$agentId', status: '$status' }, n: { $sum: 1 } } }]),
        aggregate(companyId, SCHEMA_TYPE.AI_USAGE, [{ $group: { _id: { model: '$model', feature: '$feature' }, tokens: { $sum: '$totalTokens' }, costUsd: { $sum: '$costUsd' } } }]),
        aggregate(companyId, SCHEMA_TYPE.AGENT_PROPOSALS, [{ $group: { _id: '$status', n: { $sum: 1 } } }]),
        MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_PROPOSALS, data: [{ status: 'failed', failedReason: { $regex: `^${REAPED_PREFIX}` } }] }, 'countDocuments'),
        aggregate(companyId, SCHEMA_TYPE.AUTOMATION_RUNS, [{ $group: { _id: '$status', n: { $sum: 1 } } }]),
        aggregate(companyId, SCHEMA_TYPE.AGENT_RUNS, windowed({ ...since('startedAt', w), status: { $in: TERMINAL } }, ['startedAt', 'createdAt', 'finishedAt'])),
    ]);
    const durations = finished.map(durationOf).filter((ms) => ms !== null);
    const idOf = (g, field) => String((g._id && g._id[field]) || UNKNOWN);
    return {
        companyId: String(companyId),
        runs: runGroups.map((g) => ({ agentId: idOf(g, 'agentId'), status: idOf(g, 'status'), n: numberOr0(g.n) })),
        usage: usageGroups.map((g) => ({ model: idOf(g, 'model'), feature: idOf(g, 'feature'), tokens: numberOr0(g.tokens), costUsd: numberOr0(g.costUsd) })),
        proposals: foldProposalGroups(proposalGroups, reaped),
        automations: automationGroups.map((g) => ({ status: String(g._id || UNKNOWN), n: numberOr0(g.n) })),
        durations: {
            quantiles: Object.fromEntries(QUANTILES.map((q) => [q, quantile(durations, q)])),
            sumMs: durations.reduce((n, ms) => n + ms, 0),
            count: durations.length,
        },
    };
};

const listCompanyIds = async () => {
    const rows = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.COMPANIES, data: [{}, '_id'] }, 'find');
    return (rows || []).map((r) => String(r._id));
};

const instanceSnapshot = async ({ companyIds, now = new Date() } = {}) => {
    const ids = companyIds || await listCompanyIds();
    const companies = [];
    let failures = 0;
    for (const companyId of ids) {
        try {
            // eslint-disable-next-line no-await-in-loop
            companies.push(await companyCounters(companyId, { now }));
        } catch (e) {
            failures += 1;
            logger.warn(`[agent-metrics] ${companyId}: counters skipped: ${e.message}`);
        }
    }
    return { companies, failures };
};

const escapeLabel = (v) => String(v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
const labelsOf = (labels) => {
    const entries = Object.entries(labels || {});
    return entries.length ? `{${entries.map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(',')}}` : '';
};
const sampleValue = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : 'NaN');
const family = (name, type, help, samples) => [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} ${type}`,
    ...samples.map(({ suffix = '', labels, value }) => `${name}${suffix}${labelsOf(labels)} ${sampleValue(value)}`),
];

const sumBy = (rows, keyOf, valueOf) => rows.reduce((out, row) => {
    const key = keyOf(row);
    return out.set(key, (out.get(key) || 0) + valueOf(row));
}, new Map());

const prometheusText = ({ companies = [], failures = 0 } = {}) => {
    const usage = companies.flatMap((c) => c.usage);
    const usageSamples = (valueOf) => [...sumBy(usage, (u) => JSON.stringify([u.model, u.feature]), valueOf)]
        .map(([key, value]) => { const [model, feature] = JSON.parse(key); return { labels: { model, feature }, value }; });
    const outcomes = companies.reduce((sum, c) => { PROPOSAL_OUTCOMES.forEach((o) => { sum[o] += c.proposals[o]; }); return sum; }, zeroOutcomes());
    const automations = sumBy(companies.flatMap((c) => c.automations), (a) => a.status, (a) => a.n);
    const seconds = (ms) => (ms === null ? NaN : ms / 1000);

    return [
        ...family('alianhub_agent_runs_total', 'counter', 'Agent runs retained, by company id, agent id and status.',
            companies.flatMap((c) => c.runs.map((r) => ({ labels: { company: c.companyId, agent: r.agentId, status: r.status }, value: r.n })))),
        ...family('alianhub_agent_run_duration_seconds', 'summary', `Duration of agent runs started in the last ${DURATION_WINDOW}, by company id.`,
            companies.flatMap((c) => [
                ...QUANTILES.map((q) => ({ labels: { company: c.companyId, quantile: String(q) }, value: seconds(c.durations.quantiles[q]) })),
                { suffix: '_sum', labels: { company: c.companyId }, value: c.durations.sumMs / 1000 },
                { suffix: '_count', labels: { company: c.companyId }, value: c.durations.count },
            ])),
        ...family('alianhub_ai_tokens_total', 'counter', 'Model tokens booked, by model and feature.', usageSamples((u) => u.tokens)),
        ...family('alianhub_ai_cost_usd_total', 'counter', 'Model cost booked in US dollars, by model and feature.', usageSamples((u) => u.costUsd)),
        ...family('alianhub_agent_proposals_total', 'counter', 'Agent proposals retained, by outcome.',
            PROPOSAL_OUTCOMES.map((outcome) => ({ labels: { outcome }, value: outcomes[outcome] }))),
        ...family('alianhub_automation_runs_total', 'counter', 'Automation runs retained, by status.',
            [...automations].map(([status, value]) => ({ labels: { status }, value }))),
        ...family('alianhub_metrics_company_failures', 'gauge', 'Companies whose counters could not be read on the last scrape.', [{ value: failures }]),
        '',
    ].join('\n');
};

const cachedInstanceText = (opts = {}) => cached('instanceMetrics:prometheus', async () => prometheusText(await instanceSnapshot(opts)));

module.exports = {
    WINDOWS, DEFAULT_WINDOW, CACHE_SECONDS, PROPOSAL_OUTCOMES,
    isWindow, windowOf, quantile, durationOf, outcomeOf,
    summariseAgents, summariseModels, summariseFeatures, summariseRules, summariseSteps, summarise,
    fetchWindow, companyMetrics, cachedCompanyMetrics,
    companyCounters, instanceSnapshot, prometheusText, cachedInstanceText,
};

const ACTION_DONE = 'agent.action';
const ACTION_REFUSED = 'agent.action_refused';
const PROPOSAL_DECIDED = 'agent.proposal_decided';
const APPROVED_PROPOSAL = /^approved proposal /;

const numberOrNull = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const timeOf = (v) => (v ? new Date(v).getTime() : Number.POSITIVE_INFINITY);
const plain = (row) => (row && typeof row.toObject === 'function' ? row.toObject() : row || {});

const stepEntry = (s) => ({
    kind: 'step', node: s.node, status: s.status || null, at: s.startedAt || null, endedAt: s.endedAt || null,
    durationMs: numberOrNull(s.durationMs), tokens: numberOrNull(s.tokens), costUsd: numberOrNull(s.costUsd), spanId: s.spanId || null,
});

/* Policy decisions are recorded per change in the order the run reviewed them,
 * and actions are audited in that same order, so each action takes the next
 * unclaimed decision for its key. */
const decisionQueue = (decisions) => {
    const byAction = new Map();
    for (const d of Array.isArray(decisions) ? decisions : []) {
        if (!byAction.has(d.action)) byAction.set(d.action, []);
        byAction.get(d.action).push(d.decision);
    }
    return (action) => (byAction.get(action) || []).shift() || null;
};

const decisionOf = (row, meta, nextDecision) => {
    if (row.action === PROPOSAL_DECIDED) return meta.decision || null;
    if (APPROVED_PROPOSAL.test(String(meta.reason || ''))) return 'propose';
    return nextDecision(meta.action) || (row.action === ACTION_REFUSED ? 'refuse' : null);
};

const statusOf = (row, meta) => {
    if (row.action === ACTION_REFUSED) return 'refused';
    return row.action === ACTION_DONE ? meta.state || null : null;
};

const toolEntry = (row, nextDecision) => {
    const meta = row.meta || {};
    const settled = meta.settledAt && row.createdAt ? new Date(meta.settledAt).getTime() - new Date(row.createdAt).getTime() : null;
    const cost = meta.cost || {};
    return {
        kind: 'tool', auditId: String(row._id), event: row.action, action: meta.action || row.action,
        decision: decisionOf(row, meta, nextDecision), status: statusOf(row, meta), at: row.createdAt || null,
        durationMs: settled !== null && settled >= 0 ? settled : null, tokens: numberOrNull(cost.tokens), costUsd: numberOrNull(cost.usd),
    };
};

const buildTrace = (run, auditRows) => {
    const source = plain(run);
    const steps = (Array.isArray(source.steps) ? source.steps : []).map(stepEntry);
    const nextDecision = decisionQueue(source.decisions);
    const tools = (Array.isArray(auditRows) ? auditRows : []).map(plain)
        .sort((a, b) => timeOf(a.createdAt) - timeOf(b.createdAt))
        .map((row) => toolEntry(row, nextDecision));
    return [...steps, ...tools]
        .map((entry, i) => ({ entry, i }))
        .sort((a, b) => timeOf(a.entry.at) - timeOf(b.entry.at) || a.i - b.i)
        .map(({ entry }) => entry);
};

module.exports = { buildTrace };

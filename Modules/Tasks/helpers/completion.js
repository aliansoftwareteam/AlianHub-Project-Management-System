// Provenance of Done (turn 29). Pure rules — no I/O — plus one small loader.
//
//   completion: {
//     workBy:    [{ actorId, actorType: 'human'|'agent', agentId?, viaAccount, hours }],
//     checkedBy: { actorId, actorType: 'human', at } | null,
//     closedBy:  { actorId, actorType: 'human', at } | null,   // never an agent
//     badge:     'HUMAN' | 'AGENT' | 'MIXED' | 'UNCHECKED' | null,
//     reopenCount
//   }
//
// Every field is filled by an action someone already took; nothing here is a form.

const BADGES = Object.freeze({ HUMAN: 'HUMAN', AGENT: 'AGENT', MIXED: 'MIXED', UNCHECKED: 'UNCHECKED' });
const DONE_TYPE = 'close';
const ACTOR_HUMAN = 'human';
const ACTOR_AGENT = 'agent';
const VIA_ACCOUNTS = Object.freeze(['workspace', 'personal', 'local']);
const REVIEW_STATUS_PATTERN = /review|qa|verify|testing|approval|check/i;

const empty = () => ({ workBy: [], checkedBy: null, closedBy: null, badge: null, reopenCount: 0 });

const normalize = (completion) => {
    const c = completion && typeof completion === 'object' ? completion : {};
    return {
        workBy: Array.isArray(c.workBy) ? c.workBy.map((w) => ({ ...w })) : [],
        checkedBy: c.checkedBy || null,
        closedBy: c.closedBy || null,
        badge: c.badge || null,
        reopenCount: Number(c.reopenCount) || 0,
    };
};

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

const workKey = (w) => `${w.actorType}|${w.actorId}|${w.agentId || ''}|${w.viaAccount || ''}`;

/* Merge one contribution. Entries keyed on who+what+which account, hours summed,
 * and the list kept in hours order so the first entry is the main contributor. */
const addWork = (completion, entry) => {
    const c = normalize(completion);
    if (!entry || !entry.actorId) return c;
    const next = {
        actorId: String(entry.actorId),
        actorType: entry.actorType === ACTOR_AGENT ? ACTOR_AGENT : ACTOR_HUMAN,
        agentId: entry.agentId ? String(entry.agentId) : undefined,
        viaAccount: VIA_ACCOUNTS.includes(entry.viaAccount) ? entry.viaAccount : 'workspace',
        hours: round(entry.hours),
    };
    if (next.actorType === ACTOR_HUMAN) { delete next.agentId; next.viaAccount = 'workspace'; }
    const i = c.workBy.findIndex((w) => workKey(w) === workKey(next));
    if (i === -1) c.workBy.push(next);
    else c.workBy[i] = { ...c.workBy[i], hours: round(c.workBy[i].hours + next.hours) };
    c.workBy.sort((a, b) => b.hours - a.hours);
    c.badge = deriveBadge(c);
    return c;
};

/* Replace hour totals with what the time logs say, keeping zero-hour action
 * entries (a comment, a link) that logged no time. */
const mergeLoggedHours = (completion, loggedEntries) => {
    const c = normalize(completion);
    const logged = (loggedEntries || []).filter((e) => e && e.actorId);
    const keys = new Set(logged.map(workKey));
    const kept = c.workBy.filter((w) => !keys.has(workKey(w)));
    let out = { ...c, workBy: kept };
    logged.forEach((e) => { out = addWork(out, e); });
    out.badge = deriveBadge(out);
    return out;
};

/* Four patterns (29a). UNCHECKED only ever means "agent work, nobody checked":
 * two people closing without a review is still HUMAN. */
const deriveBadge = (completion) => {
    const c = normalize(completion);
    const hasAgent = c.workBy.some((w) => w.actorType === ACTOR_AGENT);
    const hasHuman = c.workBy.some((w) => w.actorType === ACTOR_HUMAN);
    if (hasAgent && !c.checkedBy) return BADGES.UNCHECKED;
    if (hasAgent && hasHuman) return BADGES.MIXED;
    if (hasAgent) return BADGES.AGENT;
    return BADGES.HUMAN;
};

const isReviewStatus = (name) => REVIEW_STATUS_PATTERN.test(String(name || ''));

/* What a status change does to the record. `actor` is { actorId, actorType }.
 * Returns { completion, error } — error when an agent tries to close, which the
 * registry already forbids; this is the second lock on the same door. */
const applyStatusChange = ({ completion, fromStatus, toStatus, actor, now = new Date() }) => {
    const c = normalize(completion);
    const toType = String((toStatus && (toStatus.statusType || toStatus.type)) || '');
    const fromType = String((fromStatus && (fromStatus.statusType || fromStatus.type)) || '');
    const toName = (toStatus && (toStatus.name || toStatus.text)) || '';
    const fromName = (fromStatus && (fromStatus.name || fromStatus.text)) || '';
    const human = actor && actor.actorType !== ACTOR_AGENT && actor.actorId;
    const stamp = () => ({ actorId: String(actor.actorId), actorType: ACTOR_HUMAN, at: now });

    if (toType === DONE_TYPE) {
        if (!human) return { completion: c, error: 'Only a person can mark a task Done.' };
        c.closedBy = stamp();
        if (!c.checkedBy && isReviewStatus(fromName)) c.checkedBy = stamp();
    } else {
        if (fromType === DONE_TYPE) {
            c.closedBy = null;
            c.reopenCount += 1;
        }
        if (human && isReviewStatus(fromName) && !isReviewStatus(toName) && !c.checkedBy) {
            c.checkedBy = stamp();
        }
    }
    c.badge = deriveBadge(c);
    return { completion: c, error: null };
};

const markChecked = (completion, actor, now = new Date()) => {
    const c = normalize(completion);
    if (!actor || actor.actorType === ACTOR_AGENT) return { completion: c, error: 'Only a person can check a task.' };
    c.checkedBy = { actorId: String(actor.actorId), actorType: ACTOR_HUMAN, at: now };
    c.badge = deriveBadge(c);
    return { completion: c, error: null };
};

/* The badge people see. Only a closed task carries one — an open task's
 * pattern is not yet known — but the derived value is always available. */
const visibleBadge = (completion) => {
    const c = normalize(completion);
    return c.closedBy ? (c.badge || deriveBadge(c)) : null;
};

/* Time-log rows → work entries. Timesheet minutes → hours. */
const workFromTimeLogs = (rows) => {
    const byKey = new Map();
    (rows || []).forEach((r) => {
        if (!r || !r.Loggeduser) return;
        const entry = {
            actorId: String(r.Loggeduser),
            actorType: r.actorType === ACTOR_AGENT ? ACTOR_AGENT : ACTOR_HUMAN,
            agentId: r.agentId || undefined,
            viaAccount: r.viaAccount || 'workspace',
            hours: (Number(r.LogTimeDuration) || 0) / 60,
        };
        const k = workKey(entry);
        if (!byKey.has(k)) byKey.set(k, entry);
        else byKey.get(k).hours += entry.hours;
    });
    return [...byKey.values()].map((e) => ({ ...e, hours: round(e.hours) }));
};

/* Group closed tasks by pattern for rollups (29c). */
const rollup = (tasks) => {
    const out = {
        closed: 0,
        points: 0,
        byBadge: { HUMAN: { tasks: 0, points: 0 }, AGENT: { tasks: 0, points: 0 }, MIXED: { tasks: 0, points: 0 }, UNCHECKED: { tasks: 0, points: 0 } },
        firstPass: { agent: { closed: 0, firstPass: 0, pct: null }, human: { closed: 0, firstPass: 0, pct: null } },
        velocity: { total: 0, humanOnly: 0 },
    };
    (tasks || []).forEach((t) => {
        if (String(t.statusType || '') !== DONE_TYPE) return;
        const c = normalize(t.completion);
        const badge = c.badge || deriveBadge(c);
        const points = Number(t.points) || 0;
        out.closed += 1;
        out.points += points;
        out.byBadge[badge].tasks += 1;
        out.byBadge[badge].points += points;
        out.velocity.total += points;
        if (badge === BADGES.HUMAN) out.velocity.humanOnly += points;
        const bucket = badge === BADGES.HUMAN ? out.firstPass.human : out.firstPass.agent;
        bucket.closed += 1;
        if (!c.reopenCount) bucket.firstPass += 1;
    });
    ['agent', 'human'].forEach((k) => {
        const b = out.firstPass[k];
        b.pct = b.closed ? Math.round((b.firstPass / b.closed) * 100) : null;
    });
    return out;
};

/* Hours by source (27c): people / CLI agents on personal accounts / workspace agents / local model. */
const hoursBySource = (rows) => {
    const out = { people: 0, cliPersonal: 0, workspaceAgents: 0, localModel: 0, total: 0 };
    (rows || []).forEach((r) => {
        const h = (Number(r.LogTimeDuration) || 0) / 60;
        if (r.actorType !== ACTOR_AGENT) out.people += h;
        else if (r.viaAccount === 'personal') out.cliPersonal += h;
        else if (r.viaAccount === 'local') out.localModel += h;
        else out.workspaceAgents += h;
        out.total += h;
    });
    Object.keys(out).forEach((k) => { out[k] = round(out[k]); });
    return out;
};

module.exports = {
    BADGES, DONE_TYPE, ACTOR_HUMAN, ACTOR_AGENT, VIA_ACCOUNTS,
    empty, normalize, addWork, mergeLoggedHours, deriveBadge, isReviewStatus,
    applyStatusChange, markChecked, visibleBadge, workFromTimeLogs, rollup, hoursBySource,
};

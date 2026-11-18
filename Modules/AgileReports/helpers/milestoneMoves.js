// Milestone date moves (16c). The app already records every milestone date
// change in the history log, but as a prose sentence — this reads those
// sentences back into structured moves so "what moved and why" is derived from
// the audit trail rather than invented. Pure: no DB, no I/O.
//
// Written by Modules/Milestone/controller/helpers.js as, e.g.:
//   <b>Ana</b> changed <b>Beta</b> milestone due date from <b>DATE_1</b> to <b>DATE_2</b>
//   <b>Ana</b> has set the end date of  milestone <b>Beta</b> to DATE_2</b>.

const FIELDS = { start: 'startDate', end: 'endDate', due: 'dueDate' };

const CHANGED = /^<b>(.*?)<\/b>\s*changed\s*<b>(.*?)<\/b>\s*milestone\s+(start|end|due)\s+date\s+from\s+<b>DATE_(\d+)<\/b>\s*to\s*<b>DATE_(\d+)<\/b>/i;
const SET = /^<b>(.*?)<\/b>\s*has set the\s+(start|end|due)\s+date of\s+milestone\s*<b>(.*?)<\/b>\s*to\s*(?:<b>)?DATE_(\d+)/i;

const strip = (value) => String(value == null ? '' : value).replace(/<[^>]*>/g, '').trim();

/* One history row → a move, or null when the row is not a date change. */
const parseMove = (row) => {
    const message = String((row && row.Message) || '');
    const changed = message.match(CHANGED);
    if (changed) {
        return {
            actor: strip(changed[1]),
            milestoneName: strip(changed[2]),
            field: FIELDS[changed[3].toLowerCase()],
            from: Number(changed[4]),
            to: Number(changed[5]),
            at: (row && row.createdAt) || null,
            userId: String((row && row.UserId) || ''),
            projectId: String((row && row.ProjectId) || ''),
        };
    }
    const set = message.match(SET);
    if (set) {
        return {
            actor: strip(set[1]),
            milestoneName: strip(set[3]),
            field: FIELDS[set[2].toLowerCase()],
            from: null,
            to: Number(set[4]),
            at: (row && row.createdAt) || null,
            userId: String((row && row.UserId) || ''),
            projectId: String((row && row.ProjectId) || ''),
        };
    }
    return null;
};

const parseMoves = (rows = []) => (Array.isArray(rows) ? rows : [])
    .map(parseMove)
    .filter(Boolean)
    .sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));

const keyOf = (projectId, milestoneName) => `${String(projectId || '')}|${String(milestoneName || '').toLowerCase()}`;

/* Moves grouped by project + milestone name — history names the milestone, it
   does not carry its id. */
const indexMoves = (moves = []) => {
    const byMilestone = new Map();
    moves.forEach((m) => {
        const key = keyOf(m.projectId, m.milestoneName);
        if (!byMilestone.has(key)) byMilestone.set(key, []);
        byMilestone.get(key).push(m);
    });
    return byMilestone;
};

/* The date this milestone was first committed to for `field`: the earliest
   recorded "from", falling back to the current value when it never moved. */
const baselineFor = (moves = [], field, currentMs) => {
    const forField = moves.filter((m) => m.field === field);
    const firstWithFrom = forField.find((m) => Number.isFinite(m.from) && m.from > 0);
    if (firstWithFrom) return firstWithFrom.from;
    const firstSet = forField.find((m) => Number.isFinite(m.to) && m.to > 0);
    if (firstSet) return firstSet.to;
    return Number.isFinite(currentMs) && currentMs > 0 ? currentMs : null;
};

const DAY_MS = 86400000;
const slipDays = (baselineMs, currentMs) => {
    if (!Number.isFinite(baselineMs) || !Number.isFinite(currentMs) || !baselineMs || !currentMs) return null;
    return Math.round((currentMs - baselineMs) / DAY_MS);
};

module.exports = { FIELDS, parseMove, parseMoves, indexMoves, keyOf, baselineFor, slipDays, DAY_MS };

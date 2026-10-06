// Scrum sprint rules. Pure — no I/O, no app imports — so the lifecycle
// controller, the nightly cadence cron and the unit tests share one source of
// truth. Mirrors the Modules/projectSetting/autoArchiveRules.js pattern.

const DEFAULT_LENGTH_DAYS = 7;
const MIN_LENGTH_DAYS = 1;
const MAX_LENGTH_DAYS = 60;
const ROLLOVER_TARGETS = ['next', 'backlog'];

// The done-ness signal burndown, velocity, CFD and the epic recount already share.
const DONE_STATUS_TYPE = 'close';

const STATE_NONE = 'none';
const STATE_PLANNED = 'planned';
const STATE_ACTIVE = 'active';
const STATE_CLOSED = 'closed';
const STATE_OVERDUE = 'overdue';

// Only the lifecycle endpoints may write these. The generic sprint-update paths
// (PATCH /api/v1/sprint/:id and PUT /api/v1/project/sprint/:id) both apply a
// client-supplied update document verbatim, so without this list any client
// could close a sprint, move its dates or forge a commitment snapshot without
// going through the state machine.
const LIFECYCLE_FIELDS = [
    'isScrum',
    'isBacklog',
    'state',
    'startDate',
    'endDate',
    'commitment',
    'closeReport',
    'rolledFrom',
];

const startOfLocalDay = (value) => {
    const d = new Date(value);
    d.setHours(0, 0, 0, 0);
    return d;
};

const endOfLocalDay = (value) => {
    const d = new Date(value);
    d.setHours(23, 59, 59, 999);
    return d;
};

// Calendar arithmetic, not millisecond arithmetic: adding 7 * 86400000 across a
// DST boundary lands an hour off and drags the whole window with it.
const addCalendarDays = (value, days) => {
    const d = new Date(value);
    d.setDate(d.getDate() + days);
    return d;
};

const isValidDate = (value) => value instanceof Date && !Number.isNaN(value.getTime());

// Number(null) is 0 and Number('') is 0, so a field that was simply not sent
// would otherwise clamp to the minimum instead of falling back to the default.
const isAbsent = (value) => value === null || value === undefined || value === '';

/* Clamp arbitrary input into a safe cadence rule. */
function normaliseCadence(input) {
    const src = input && typeof input === 'object' ? input : {};

    let lengthDays = isAbsent(src.lengthDays) ? NaN : Number(src.lengthDays);
    if (!Number.isFinite(lengthDays)) lengthDays = DEFAULT_LENGTH_DAYS;
    lengthDays = Math.min(MAX_LENGTH_DAYS, Math.max(MIN_LENGTH_DAYS, Math.round(lengthDays)));

    // null means "start whenever the caller asked", which is what a sprint
    // created by hand mid-week needs.
    let startWeekday = isAbsent(src.startWeekday) ? NaN : Number(src.startWeekday);
    if (!Number.isInteger(startWeekday) || startWeekday < 0 || startWeekday > 6) startWeekday = null;

    return {
        enabled: src.enabled === true,
        lengthDays,
        startWeekday,
        autoClose: src.autoClose === true,
        autoCreateNext: src.autoCreateNext === true,
        rolloverTarget: ROLLOVER_TARGETS.includes(src.rolloverTarget) ? src.rolloverTarget : 'next',
    };
}

/* The next time box on or after `from`. Local calendar boundaries — a sprint
   week is Mon 00:00 → Fri 23:59:59.999 where the team lives, not a fixed number
   of milliseconds. Returns null when `from` is not a usable date. */
function computeWindow(cadence, from) {
    const rule = normaliseCadence(cadence);
    // new Date(null) is the epoch, not an error — a missing start date would
    // otherwise silently produce a sprint that ran in 1970.
    if (isAbsent(from)) return null;
    const base = new Date(from);
    if (!isValidDate(base)) return null;

    let startDate = startOfLocalDay(base);
    if (rule.startWeekday !== null) {
        const shift = (rule.startWeekday - startDate.getDay() + 7) % 7;
        if (shift) startDate = addCalendarDays(startDate, shift);
    }
    return { startDate, endDate: endOfLocalDay(addCalendarDays(startDate, rule.lengthDays - 1)) };
}

/* `Sprint 12` → `Sprint 13`, `Week 34` → `Week 35`.

   A trailing run of four or more digits is left alone: real sprint names here
   end in a year ("AHE - 24 - 28 Aug 2026"), and bumping that to 2027 is worse
   than admitting the name cannot be continued. */
const MAX_BUMPABLE_DIGITS = 3;

function nextSprintName(previousName) {
    const name = String(previousName == null ? '' : previousName).trim();
    if (!name) return 'Sprint 1';

    const match = name.match(/^(.*?)(\d+)\s*$/);
    if (!match || match[2].length > MAX_BUMPABLE_DIGITS) return `${name} (next)`;

    const digits = match[2];
    const bumped = String(Number(digits) + 1);
    return `${match[1]}${digits[0] === '0' ? bumped.padStart(digits.length, '0') : bumped}`;
}

/* The single place that decides what state a sprint is in.

   'overdue' is derived, never stored: an active sprint past its end date still
   needs completing, and storing it would mean a write just because time passed. */
function deriveState(sprint, now) {
    const doc = sprint && typeof sprint === 'object' ? sprint : {};
    if (doc.isScrum !== true) return STATE_NONE;

    const stored = String(doc.state || '');
    if (stored === STATE_CLOSED) return STATE_CLOSED;
    if (stored !== STATE_ACTIVE) return STATE_PLANNED;

    const end = new Date(doc.endDate);
    const at = now === undefined ? new Date() : new Date(now);
    if (isValidDate(end) && isValidDate(at) && end.getTime() < at.getTime()) return STATE_OVERDUE;
    return STATE_ACTIVE;
}

/* Split a sprint's tasks into what shipped and what did not. */
function splitByDone(tasks) {
    const done = [];
    const notDone = [];
    (Array.isArray(tasks) ? tasks : []).forEach((task) => {
        if (!task) return;
        if (String(task.statusType || '') === DONE_STATUS_TYPE) done.push(task);
        else notDone.push(task);
    });
    return { done, notDone };
}

/* The snapshot written once when a sprint starts. `taskIds` is what makes scope
   added mid-sprint detectable later — without it "committed vs completed" is a
   tautology, because committed would just be read back off the current tasks. */
function summariseCommitment(tasks) {
    const list = (Array.isArray(tasks) ? tasks : []).filter(Boolean);
    const taskIds = [];
    let points = 0;
    let minutes = 0;

    list.forEach((task) => {
        const p = Number(task.points);
        if (Number.isFinite(p)) points += p;
        const m = Number(task.totalEstimatedTime);
        if (Number.isFinite(m)) minutes += m;
        if (task._id) taskIds.push(String(task._id));
    });

    return { tasks: list.length, points, minutes, taskIds };
}

/* The first lifecycle-owned field a generic update document would write, or
   null. Handles operator form ({ $set: { state } }), plain form ({ state }),
   dotted paths ('commitment.points') and aggregation-pipeline updates. */
function findLifecycleWrite(updateObject) {
    if (!updateObject || typeof updateObject !== 'object') return null;

    if (Array.isArray(updateObject)) {
        for (const stage of updateObject) {
            const hit = findLifecycleWrite(stage);
            if (hit) return hit;
        }
        return null;
    }

    const owned = (key) => {
        const root = String(key).split('.')[0];
        return LIFECYCLE_FIELDS.includes(root) ? root : null;
    };

    for (const [key, value] of Object.entries(updateObject)) {
        if (key.startsWith('$')) {
            if (value && typeof value === 'object') {
                for (const inner of Object.keys(value)) {
                    const hit = owned(inner);
                    if (hit) return hit;
                }
            }
            continue;
        }
        const hit = owned(key);
        if (hit) return hit;
    }
    return null;
}

module.exports = {
    normaliseCadence,
    computeWindow,
    nextSprintName,
    deriveState,
    splitByDone,
    summariseCommitment,
    findLifecycleWrite,

    DEFAULT_LENGTH_DAYS,
    MIN_LENGTH_DAYS,
    MAX_LENGTH_DAYS,
    ROLLOVER_TARGETS,
    DONE_STATUS_TYPE,
    LIFECYCLE_FIELDS,
    STATE_NONE,
    STATE_PLANNED,
    STATE_ACTIVE,
    STATE_CLOSED,
    STATE_OVERDUE,
};

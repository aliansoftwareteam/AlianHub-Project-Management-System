/* Risk score for a task row (List + Table "✦ RISK" column).
 *
 * There is no risk endpoint. The score is derived, deterministically, from
 * fields a task already carries, so the same task always scores the same on
 * every client and nothing is invented. CommonJS so tests/task-risk.test.js can
 * require it directly, like composables/criticalPath.js. */

const DAY_MS = 86400000;

const WEIGHTS = {
    overdue: 32,
    blocked: 26,
    burn: 18,
    silence: 14,
    subtasks: 10,
};

const LOW_MAX = 33;
const MED_MAX = 66;
const SILENCE_GRACE_DAYS = 3;
const DUE_SOON_DAYS = 2;

const toTime = (value) => {
    if (value === null || value === undefined || value === '') return NaN;
    if (typeof value === 'object' && value.seconds) return value.seconds * 1000;
    const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isNaN(t) ? NaN : t;
};

const daysBetween = (from, to) => {
    if (Number.isNaN(from) || Number.isNaN(to)) return 0;
    return Math.floor((to - from) / DAY_MS);
};

const clamp = (value, max) => Math.max(0, Math.min(max, Math.round(value)));

const isDone = (task) => {
    const type = String(task && task.statusType || '').toLowerCase();
    if (type === 'close' || type === 'done') return true;
    const statusType = String(task && task.status && task.status.type || '').toLowerCase();
    return statusType === 'close' || statusType === 'done';
};

/* Blocked is not a status type in the data model — a project defines its own
 * statuses — so it is read from the status name the project chose, or from a
 * blocked_by relation, whichever the workspace actually uses. */
const isBlocked = (task) => {
    const name = String((task && task.status && (task.status.text || task.status.value)) || task.statusName || '');
    if (/block/i.test(name)) return true;
    const relations = Array.isArray(task && task.relations) ? task.relations : [];
    return relations.some((relation) => String(relation && relation.type || '').toLowerCase() === 'blocked_by');
};

const lastActivityAt = (task) => {
    const candidates = [task && task.lastMessage, task && task.Updated_At, task && task.updatedAt, task && task.createdAt]
        .map(toTime)
        .filter((t) => !Number.isNaN(t));
    return candidates.length ? Math.max.apply(null, candidates) : NaN;
};

const subtaskProgress = (task) => {
    const loaded = Array.isArray(task && task.subtaskArray) ? task.subtaskArray : [];
    const total = loaded.length || Number(task && task.subTasks) || 0;
    if (!total) return null;
    const done = loaded.filter(isDone).length;
    return { total, done, ratio: done / total };
};

function overdueFactor(task, now) {
    const due = toTime(task && task.DueDate);
    if (Number.isNaN(due)) return null;
    const days = daysBetween(due, now);
    if (days < 1) return null;
    return { key: 'overdue', points: clamp(6 + days * 5, WEIGHTS.overdue), days };
}

function blockedFactor(task, now) {
    if (!isBlocked(task)) return null;
    const since = lastActivityAt(task);
    const days = Number.isNaN(since) ? 0 : Math.max(0, daysBetween(since, now));
    return { key: 'blocked', points: clamp(10 + days * 2, WEIGHTS.blocked), days };
}

/* Estimate vs logged. `remainingHours` is server-maintained as
 * estimate − everyone's logged time (Modules/LogTime/controllerV2/helpers.js),
 * so logged is the difference. Both are minutes. */
function burnFactor(task) {
    const estimate = Number(task && task.totalEstimatedTime) || 0;
    if (estimate <= 0) return null;
    const remainingRaw = Number(task && task.remainingHours);
    const remaining = Number.isFinite(remainingRaw) ? remainingRaw : estimate;
    const logged = estimate - Math.min(remaining, estimate);
    if (logged <= estimate) return null;
    const over = (logged - estimate) / estimate;
    return { key: 'burn', points: clamp(WEIGHTS.burn * over, WEIGHTS.burn), overPct: Math.round(over * 100) };
}

function silenceFactor(task, now) {
    const since = lastActivityAt(task);
    if (Number.isNaN(since)) return null;
    const days = daysBetween(since, now);
    if (days <= SILENCE_GRACE_DAYS) return null;
    return { key: 'silence', points: clamp((days - SILENCE_GRACE_DAYS) * 1.5, WEIGHTS.silence), days };
}

function subtaskFactor(task, now) {
    const progress = subtaskProgress(task);
    if (!progress || progress.ratio >= 1) return null;
    const due = toTime(task && task.DueDate);
    const pressing = !Number.isNaN(due) && daysBetween(due, now) >= -DUE_SOON_DAYS;
    const points = clamp(WEIGHTS.subtasks * (1 - progress.ratio) * (pressing ? 1 : 0.4), WEIGHTS.subtasks);
    if (!points) return null;
    return { key: 'subtasks', points, done: progress.done, total: progress.total };
}

function riskLevel(score) {
    if (score <= LOW_MAX) return 'low';
    if (score <= MED_MAX) return 'med';
    return 'high';
}

/**
 * @returns {{score:number, level:'low'|'med'|'high', factors:Array, top:Object|null}}
 */
function taskRisk(task, options) {
    const opts = options || {};
    const now = Number.isFinite(opts.now) ? opts.now : Date.now();
    if (!task || typeof task !== 'object') return { score: 0, level: 'low', factors: [], top: null };
    if (isDone(task)) return { score: 0, level: 'low', factors: [], top: null };

    const factors = [
        overdueFactor(task, now),
        blockedFactor(task, now),
        burnFactor(task),
        silenceFactor(task, now),
        subtaskFactor(task, now),
    ].filter((factor) => factor && factor.points > 0);

    factors.sort((a, b) => b.points - a.points);
    const score = Math.min(100, factors.reduce((total, factor) => total + factor.points, 0));
    return { score, level: riskLevel(score), factors, top: factors[0] || null };
}

module.exports = { taskRisk, riskLevel, isBlocked, isDone, WEIGHTS, LOW_MAX, MED_MAX, DAY_MS };

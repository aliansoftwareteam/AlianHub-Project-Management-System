const { RELATION_TYPES } = require('./relationRules');

const COLLISION_LINE = 'Dates overlap. Blocked task stayed put.';
const EMPTY_LINE = 'No scheduled tasks yet…';
const DEFAULT_TZ = 'Asia/Kolkata';

const calendarDayInZone = (value = new Date(), timeZone = DEFAULT_TZ) => {
    const d = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(d.getTime())) return null;
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: timeZone || DEFAULT_TZ,
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
            hourCycle: 'h23',
        }).formatToParts(d);
        const raw = (type) => Number((parts.find((p) => p.type === type) || {}).value);
        const y = raw('year');
        const m = raw('month');
        const day = raw('day');
        const hour = raw('hour');
        const minute = raw('minute');
        if (!y || !m || !day) return null;
        return {
            y,
            m: m - 1,
            day,
            hour: Number.isFinite(hour) ? hour : 0,
            minute: Number.isFinite(minute) ? minute : 0,
        };
    } catch (e) {
        return { y: d.getFullYear(), m: d.getMonth(), day: d.getDate(), hour: d.getHours(), minute: d.getMinutes() };
    }
};

const todayLineDate = (value = new Date(), scale = 'Week', timeZone = DEFAULT_TZ) => {
    const parts = calendarDayInZone(value, timeZone);
    if (!parts) return null;
    if (scale === 'Day') return new Date(parts.y, parts.m, parts.day, parts.hour, parts.minute, 0, 0);
    return new Date(parts.y, parts.m, parts.day, 12, 0, 0, 0);
};

const toTime = (value) => {
    if (!value) return NaN;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : NaN;
};

const planBarMove = ({ movedTaskId, startDate, dueDate, tasks = [] }) => {
    const id = String(movedTaskId || '');
    const updates = [{ taskId: id, startDate, dueDate }];
    const dependentsUnchanged = (tasks || [])
        .filter((task) => task && String(task._id) !== id)
        .map((task) => String(task._id));
    return { updates, dependentsUnchanged, cascade: false };
};

const fsCollision = ({ predecessorDue, successorStart }) => {
    const due = toTime(predecessorDue);
    const start = toTime(successorStart);
    if (!Number.isFinite(due) || !Number.isFinite(start)) return false;
    return start < due;
};

const collisionHints = (tasks = [], relationsByTaskId = {}) => {
    const byId = new Map((tasks || []).map((task) => [String(task._id), task]));
    const hints = [];
    const seen = new Set();
    (tasks || []).forEach((task) => {
        const sourceId = String(task._id);
        const rels = relationsByTaskId[sourceId] || task.relations || [];
        rels.forEach((rel) => {
            if (!rel || rel.type !== RELATION_TYPES.BLOCKS) return;
            const targetId = String(rel.taskId);
            const key = `${sourceId}->${targetId}`;
            if (seen.has(key)) return;
            seen.add(key);
            const target = byId.get(targetId);
            if (!target) return;
            if (fsCollision({ predecessorDue: task.DueDate, successorStart: target.startDate })) {
                hints.push({
                    sourceId,
                    targetId,
                    hint: 'collision',
                    css: 'gantt-link--collision',
                    line: COLLISION_LINE,
                    banner: false,
                });
            }
        });
    });
    return hints;
};

module.exports = {
    COLLISION_LINE,
    EMPTY_LINE,
    DEFAULT_TZ,
    calendarDayInZone,
    todayLineDate,
    planBarMove,
    fsCollision,
    collisionHints,
};

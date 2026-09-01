const { RELATION_TYPES } = require('./relationRules');

const COLLISION_LINE = 'Dates overlap. Blocked task stayed put.';
const EMPTY_LINE = 'No scheduled tasks yet…';

const localCalendarDay = (value = new Date()) => {
    const d = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(d.getTime())) return null;
    return { y: d.getFullYear(), m: d.getMonth(), day: d.getDate() };
};

const todayLineDate = (value = new Date(), scale = 'Week') => {
    const parts = localCalendarDay(value);
    if (!parts) return null;
    if (scale === 'Day') return new Date(parts.y, parts.m, parts.day, 0, 0, 0, 0);
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
    localCalendarDay,
    todayLineDate,
    planBarMove,
    fsCollision,
    collisionHints,
};

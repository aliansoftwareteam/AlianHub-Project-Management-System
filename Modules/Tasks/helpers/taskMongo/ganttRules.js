const { RELATION_TYPES } = require('./relationRules');

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
                });
            }
        });
    });
    return hints;
};

module.exports = {
    planBarMove,
    fsCollision,
    collisionHints,
};

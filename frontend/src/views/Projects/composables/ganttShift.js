/* The Gantt's rescheduling rule: when a move pushes a blocker's end later, every task it blocks
 * (finish-to-start, the only dependency AlianHub stores) moves later by whole days, keeping its
 * length. Moving a blocker earlier pulls nothing back. CommonJS so the jest suite can require it. */

const MAX_STEPS = 36600;

const toDate = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const workingDaySet = (days) => (Array.isArray(days) && days.length ? new Set(days.map(Number)) : null);

/* Local-calendar steps, so a daylight-saving change never nudges a bar off its hour. */
const nextWorkingDay = (date, working) => {
    const next = new Date(date.getTime());
    for (let i = 0; i < 7; i += 1) {
        next.setDate(next.getDate() + 1);
        if (!working || working.has(next.getDay())) return next;
    }
    return next;
};

const addWorkingDays = (date, count, working) => {
    let at = date;
    for (let i = 0; i < count; i += 1) at = nextWorkingDay(at, working);
    return at;
};

/* The due date is the instant a task ends, so its last occupied day is the one just before it. */
const shiftBy = ({ start, end }, count, working) => ({
    start: addWorkingDays(start, count, working),
    end: new Date(addWorkingDays(new Date(end.getTime() - 1), count, working).getTime() + 1),
});

const stepsUntil = (start, required, working) => {
    let at = start;
    let steps = 0;
    while (at < required && steps < MAX_STEPS) {
        at = nextWorkingDay(at, working);
        steps += 1;
    }
    return steps;
};

const findCycle = (rootId, successors) => {
    const state = new Map();
    const stack = [];
    const visit = (id) => {
        state.set(id, 'open');
        stack.push(id);
        for (const next of successors.get(id) || []) {
            if (state.get(next) === 'open') return [...stack.slice(stack.indexOf(next)), next];
            if (!state.has(next)) {
                const found = visit(next);
                if (found) return found;
            }
        }
        stack.pop();
        state.set(id, 'done');
        return null;
    };
    return visit(rootId) || [];
};

/*
 * tasks: [{ id, startDate, DueDate }], links: [{ source, target }] where source blocks target.
 * options.workingDays: weekday numbers (0 = Sunday) that count; empty or absent counts every day.
 * options.canEdit(id): false leaves that task in place and reports it as a conflict.
 * Returns shifts in the order they cascade, conflicts, and the first loop found as [a, ..., a].
 */
const shiftDependants = (tasks, links, movedId, newDates, options = {}) => {
    const result = { shifts: [], conflicts: [], cycle: [] };
    const canEdit = typeof options.canEdit === 'function' ? options.canEdit : () => true;
    const working = workingDaySet(options.workingDays);

    const byId = new Map();
    (tasks || []).forEach((task) => {
        const start = toDate(task && task.startDate);
        const end = toDate(task && task.DueDate);
        if (start && end) byId.set(String(task.id), { start, end });
    });
    const rootId = String(movedId);
    const moved = byId.get(rootId);
    const movedStart = toDate(newDates && newDates.startDate);
    const movedEnd = toDate(newDates && newDates.DueDate);
    if (!moved || !movedStart || !movedEnd || movedEnd <= moved.end) return result;

    const successors = new Map();
    const predecessors = new Map();
    const seen = new Set();
    (links || []).forEach((link) => {
        const source = String(link && link.source);
        const target = String(link && link.target);
        const key = `${source}_${target}`;
        if (!byId.has(source) || !byId.has(target) || seen.has(key)) return;
        seen.add(key);
        if (!successors.has(source)) successors.set(source, []);
        if (!predecessors.has(target)) predecessors.set(target, []);
        successors.get(source).push(target);
        predecessors.get(target).push(source);
    });

    const reached = new Set([rootId]);
    const pending = [rootId];
    while (pending.length) {
        (successors.get(pending.shift()) || []).forEach((next) => {
            if (!reached.has(next)) {
                reached.add(next);
                pending.push(next);
            }
        });
    }

    result.cycle = findCycle(rootId, successors);

    const inDegree = new Map([...reached].map((id) => [id, 0]));
    reached.forEach((id) => (successors.get(id) || []).forEach((next) => inDegree.set(next, inDegree.get(next) + 1)));

    /* Only blockers this move changed count; an overlap that was already there is not this move's doing.
     * A task in a loop, or behind one, never reaches in-degree zero, so the cascade stops there. */
    const changed = new Map([[rootId, { start: movedStart, end: movedEnd }]]);
    const queue = inDegree.get(rootId) === 0 ? [rootId] : [];
    while (queue.length) {
        const id = queue.shift();
        if (id !== rootId) {
            const current = byId.get(id);
            const required = (predecessors.get(id) || [])
                .filter((blocker) => changed.has(blocker))
                .reduce((latest, blocker) => {
                    const end = changed.get(blocker).end;
                    return !latest || end > latest ? end : latest;
                }, null);
            if (required && current.start < required) {
                const days = stepsUntil(current.start, required, working);
                if (canEdit(id)) {
                    const to = shiftBy(current, days, working);
                    changed.set(id, to);
                    result.shifts.push({
                        id,
                        days,
                        from: { startDate: current.start, DueDate: current.end },
                        to: { startDate: to.start, DueDate: to.end },
                    });
                } else {
                    result.conflicts.push({ id, days });
                }
            }
        }
        (successors.get(id) || []).forEach((next) => {
            inDegree.set(next, inDegree.get(next) - 1);
            if (inDegree.get(next) === 0) queue.push(next);
        });
    }
    return result;
};

module.exports = { shiftDependants };

// Pure rules for measuring workload in story points or open-task count. Days are 'YYYY-MM-DD'.
// Unit-tested in tests/workload-units.test.js.

const { DEFAULT_WEEKEND, isoDay } = require('./weekRules');

const UNITS = Object.freeze(['hours', 'points', 'count']);
const PERIODS = Object.freeze(['day', 'week']);
const MAX_CAPACITY = 1000;
const DEFAULT_WORK_DAYS = 5;
const DEFAULT_CAPACITY = Object.freeze({
    points: Object.freeze({ value: 10, per: 'week' }),
    count: Object.freeze({ value: 10, per: 'week' }),
});
const CAPACITY_UNITS = Object.keys(DEFAULT_CAPACITY);

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const round = (n) => Math.round(n * 100) / 100;
const validAmount = (raw) => typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= MAX_CAPACITY;

const unitOf = (raw) => (UNITS.includes(raw) ? raw : 'hours');

const capacityOf = (raw) => {
    const source = isPlainObject(raw) ? raw : {};
    return Object.fromEntries(CAPACITY_UNITS.map((unit) => {
        const entry = isPlainObject(source[unit]) ? source[unit] : {};
        const usable = validAmount(entry.value) && PERIODS.includes(entry.per);
        return [unit, usable ? { value: entry.value, per: entry.per } : { ...DEFAULT_CAPACITY[unit] }];
    }));
};

const capacityProblem = (raw) => {
    if (!isPlainObject(raw)) return 'Capacity must be an object.';
    const unknown = Object.keys(raw).find((unit) => !CAPACITY_UNITS.includes(unit));
    if (unknown) return `There is no capacity for ${unknown}; use ${CAPACITY_UNITS.join(' or ')}.`;
    const bad = Object.keys(raw).find((unit) => !isPlainObject(raw[unit]) || !validAmount(raw[unit].value) || !PERIODS.includes(raw[unit].per));
    if (bad) return `The ${bad} capacity needs a value from 0 to ${MAX_CAPACITY} per ${PERIODS.join(' or ')}.`;
    return null;
};

const perDayAmount = (entry, workDaysPerWeek = DEFAULT_WORK_DAYS) => {
    const days = Number(workDaysPerWeek) > 0 ? Number(workDaysPerWeek) : DEFAULT_WORK_DAYS;
    return entry.per === 'day' ? entry.value : round(entry.value / days);
};

/* A person's share of a task's points follows their share of its planned hours, the way the
 * hours grid already splits work; with no hours planned it is split evenly between assignees. */
const pointShares = (task, plannedByUser = {}) => {
    const points = Number(task.points);
    const worth = Number.isFinite(points) && points > 0 ? points : 0;
    const planned = Object.entries(plannedByUser).filter(([, minutes]) => Number(minutes) > 0);
    const total = planned.reduce((sum, [, minutes]) => sum + Number(minutes), 0);
    if (total > 0) return Object.fromEntries(planned.map(([uid, minutes]) => [uid, round((worth * Number(minutes)) / total)]));
    const assignees = [...new Set((task.AssigneeUserId || []).map(String))];
    return Object.fromEntries(assignees.map((uid) => [uid, assignees.length ? round(worth / assignees.length) : 0]));
};

const isUnpointed = (task) => !(Number.isFinite(Number(task.points)) && task.points !== null && task.points !== '');

/* One chip per open task and person, on the task's due day when that falls in the range,
 * otherwise on the last day that person planned for it in the range. */
const unitChips = ({ unit, tasks = [], userIds = [], days = [], plannedDays = {}, plannedMinutes = {}, projectsById = {} }) => {
    const inRange = new Set(days);
    const wanted = new Set(userIds.map(String));
    const chipsByUser = {};
    const unpointedByUser = {};
    const unpointedTasks = new Set();
    tasks.forEach((task) => {
        const taskId = String(task._id);
        const plannedByUser = plannedMinutes[taskId] || {};
        const shares = pointShares(task, plannedByUser);
        const people = new Set([...(task.AssigneeUserId || []).map(String), ...Object.keys(plannedDays[taskId] || {})]);
        const due = task.DueDate ? isoDay(new Date(task.DueDate)) : '';
        const project = projectsById[String(task.ProjectID)] || null;
        people.forEach((uid) => {
            if (!wanted.has(uid)) return;
            const planned = [...((plannedDays[taskId] || {})[uid] || [])].filter((d) => inRange.has(d)).sort();
            const day = inRange.has(due) ? due : planned[planned.length - 1];
            if (!day) return;
            const amount = unit === 'count' ? 1 : (shares[uid] || 0);
            const perUser = chipsByUser[uid] || (chipsByUser[uid] = {});
            (perUser[day] || (perUser[day] = [])).push({
                taskId,
                name: task.TaskName || '',
                projectId: String(task.ProjectID || ''),
                projectName: project ? project.ProjectName || '' : '',
                projectColor: project && project.projectIcon && project.projectIcon.type === 'color' ? project.projectIcon.data : '',
                sprintId: String(task.sprintId || ''),
                amount,
                unpointed: isUnpointed(task),
            });
            if (unit === 'points' && isUnpointed(task)) {
                unpointedByUser[uid] = (unpointedByUser[uid] || 0) + 1;
                unpointedTasks.add(taskId);
            }
        });
    });
    return { chipsByUser, unpointedByUser, unpointed: unpointedTasks.size };
};

const unitDays = ({ days = [], perDay = 0, ptoDays = [], weekendDays = DEFAULT_WEEKEND, chipsByDay = {} } = {}) => {
    let totalLoad = 0;
    let capacity = 0;
    const out = days.map((date) => {
        const weekend = weekendDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay());
        const pto = ptoDays.includes(date);
        const dayCapacity = weekend || pto ? 0 : perDay;
        const chips = chipsByDay[date] || [];
        const load = round(chips.reduce((sum, chip) => sum + (Number(chip.amount) || 0), 0));
        totalLoad += load;
        capacity += dayCapacity;
        return { date, weekend, pto, capacity: dayCapacity, load, chips, over: dayCapacity > 0 ? load > dayCapacity : load > 0 };
    });
    totalLoad = round(totalLoad);
    capacity = round(capacity);
    const utilizationPct = capacity > 0 ? Math.round((totalLoad / capacity) * 100) : (totalLoad > 0 ? 100 : 0);
    return { days: out, totalLoad, capacity, utilizationPct };
};

module.exports = {
    UNITS,
    PERIODS,
    MAX_CAPACITY,
    DEFAULT_CAPACITY,
    unitOf,
    capacityOf,
    capacityProblem,
    perDayAmount,
    pointShares,
    unitChips,
    unitDays,
};

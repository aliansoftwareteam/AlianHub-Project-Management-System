const { DAY_MS, localDayStart } = require('../../../utils/localDay');
const { isClosedTask, isBlockedTask } = require('../../Tasks/helpers/taskSignals');
const { riskWindow, riskReasons } = require('../../UserDashboard/atRisk');
const ptoRules = require('../../Pto/helpers/ptoRules');

// What a project's daily look finds. Every finding is a rule over rows already read: nothing here asks a model,
// reads the database or sends anything. A finding carries `fix` only where the change needs no judgement.

const RULE = Object.freeze({
    SLIPPING: 'slipping', BLOCKED: 'blocked', OVERLOADED: 'overloaded', UNTRIAGED: 'untriaged', STALE: 'stale', NO_OWNER: 'no_owner', NO_ESTIMATE: 'no_estimate',
});
const MOST_URGENT_FIRST = Object.freeze([RULE.SLIPPING, RULE.BLOCKED, RULE.OVERLOADED, RULE.UNTRIAGED, RULE.STALE, RULE.NO_OWNER, RULE.NO_ESTIMATE]);
const STALE_WORKING_DAYS = 5;
const QUIET_BLOCKER_WORKING_DAYS = 3;
// The capacity report's own default (Modules/CapacityPlanning/controller.js), so the two agree on what a week holds.
const HOURS_PER_DAY = 8;
const NOT_STARTED = 'default_active';
const INBOUND = Object.freeze(['email', 'form']);
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const COUNTED_BACK_DAYS = 400;

const idOf = (task) => String(task._id);
const time = (value) => (value ? new Date(value).getTime() : NaN);
const dayStart = (at) => localDayStart(at, 0).getTime();
const ymd = (at) => new Date(at).toISOString().slice(0, 10);
const refOf = (task) => ({ taskKey: task.TaskKey || '', taskName: task.TaskName || '' });
const statusTypeOf = (task) => String(task.statusType || (task.status && task.status.type) || '').toLowerCase();
const assigneesOf = (task) => (Array.isArray(task.AssigneeUserId) ? task.AssigneeUserId : [task.AssigneeUserId]).filter(Boolean);
const hasEstimate = (task) => Number(task.totalEstimatedTime) > 0 || Number(task.points) > 0;
const sameList = (a, b) => String(a.ProjectID || '') === String(b.ProjectID || '') && String(a.sprintId || '') === String(b.sprintId || '');

const isWorkingDay = (at, week) => week.includes(new Date(dayStart(at)).getUTCDay());

/* The working days that have passed since the day of `at`, today included. */
const workingDaysSince = (at, now, week) => {
    if (!at) return 0;
    const today = dayStart(now);
    let count = 0;
    for (let day = Math.max(dayStart(at), today - COUNTED_BACK_DAYS * DAY_MS) + DAY_MS; day <= today; day += DAY_MS) {
        if (week.includes(new Date(day).getUTCDay())) count += 1;
    }
    return count;
};

const openBlockersOf = (task, byId) => (Array.isArray(task.relations) ? task.relations : [])
    .filter((relation) => String((relation && relation.type) || '').toLowerCase() === 'blocked_by')
    .map((relation) => byId.get(String(relation.taskId)))
    .filter((blocker) => blocker && !isClosedTask(blocker));

const worst = (list, weight) => list.filter((row) => row[weight] > 0).sort((a, b) => b[weight] - a[weight])[0] || null;

const comment = (on, body) => ({ action: 'task.comment', params: { taskId: idOf(on), body }, label: `Comment on ${on.TaskKey || 'the task'}: "${body}"` });

const slipping = (task, { window, byId }) => {
    const { daysLate } = riskReasons(task, window);
    const start = time(task.startDate);
    const wait = worst(openBlockersOf(task, byId).map((blocker) => ({ blocker, days: Math.ceil((time(blocker.DueDate) - start) / DAY_MS) })), 'days');
    if (!wait) {
        return daysLate ? { rule: RULE.SLIPPING, key: `slipping:${idOf(task)}:overdue`, taskId: idOf(task), taskIds: [idOf(task)], weight: daysLate, facts: { ...refOf(task), daysLate } } : null;
    }
    const { blocker, days } = wait;
    const later = (value) => new Date(time(value) + days * DAY_MS);
    const fields = { startDate: later(task.startDate), ...(task.DueDate ? { DueDate: later(task.DueDate) } : {}) };
    const moved = Object.entries(fields).map(([field, value]) => `${field === 'DueDate' ? 'due' : 'start'} ${ymd(value)}`).join(', ');
    return {
        rule: RULE.SLIPPING, key: `slipping:${idOf(task)}:waits:${idOf(blocker)}`, taskId: idOf(task), taskIds: [idOf(task), idOf(blocker)], weight: Math.max(days, daysLate),
        facts: { ...refOf(task), blockerKey: blocker.TaskKey || '', blockerName: blocker.TaskName || '', days, daysLate },
        ...(sameList(task, blocker) ? { fix: {
            action: 'task.update', params: { taskId: idOf(task), fields }, label: `Move ${task.TaskKey || 'the task'} ${days} days later: ${moved}`,
            what: `Move ${task.TaskKey || 'a task'} ${days} days later`, why: `It waits on ${blocker.TaskKey || 'a task'}, which now ends ${days} days after this task starts.`,
        } } : {}),
    };
};

const blocked = (task, { byId, now, week }) => {
    if (!isBlockedTask(task)) return null;
    const wait = worst(openBlockersOf(task, byId).map((blocker) => ({ blocker, quietDays: workingDaysSince(blocker.updatedAt, now, week) })), 'quietDays');
    if (!wait || wait.quietDays < QUIET_BLOCKER_WORKING_DAYS) return null;
    const { blocker, quietDays } = wait;
    const body = `${task.TaskKey || 'A task'} is waiting on this task, and this task has not changed for ${quietDays} working days. What does it need to move?`;
    return {
        rule: RULE.BLOCKED, key: `blocked:${idOf(task)}:${idOf(blocker)}`, taskId: idOf(task), taskIds: [idOf(task), idOf(blocker)], weight: quietDays,
        facts: { ...refOf(task), blockerKey: blocker.TaskKey || '', blockerName: blocker.TaskName || '', quietDays },
        ...(sameList(task, blocker) ? { fix: {
            ...comment(blocker, body),
            what: `Ask what ${blocker.TaskKey || 'a task'} needs to move`, why: `${task.TaskKey || 'A task'} waits on it, and it has not changed for ${quietDays} working days.`,
        } } : {}),
    };
};

/* Started work that has gone quiet. Work nobody has started is a backlog, not a stall. */
const stale = (task, { now, week }) => {
    const quietDays = workingDaysSince(task.updatedAt, now, week);
    if (statusTypeOf(task) === NOT_STARTED || quietDays < STALE_WORKING_DAYS) return null;
    const body = `This task has not changed for ${quietDays} working days. Is it still moving? Please add a short update.`;
    return {
        rule: RULE.STALE, key: `stale:${idOf(task)}`, taskId: idOf(task), taskIds: [idOf(task)], weight: quietDays, facts: { ...refOf(task), quietDays },
        fix: { ...comment(task, body), what: `Ask for an update on ${task.TaskKey || 'a task'}`, why: `No change for ${quietDays} working days.` },
    };
};

const plain = (rule, task, facts = {}) => ({ rule, key: `${rule}:${idOf(task)}`, taskId: idOf(task), taskIds: [idOf(task)], weight: 0, facts: { ...refOf(task), ...facts } });

const untriaged = (task) => {
    const origin = String((task.origin && task.origin.kind) || '');
    return INBOUND.includes(origin) && !assigneesOf(task).length && !hasEstimate(task) ? plain(RULE.UNTRIAGED, task, { origin }) : null;
};
const noOwner = (task) => (assigneesOf(task).length ? null : plain(RULE.NO_OWNER, task));
const noEstimate = (task) => (hasEstimate(task) ? null : plain(RULE.NO_ESTIMATE, task));

const weekOf = (now) => {
    const today = dayStart(now);
    const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY_MS;
    return { start: new Date(monday), end: new Date(monday + 6 * DAY_MS) };
};

/* Hours planned on this project's open tasks this week, against what the person's week holds after approved time off. */
const overloaded = ({ open, plans, pto, now, week }) => {
    const { start, end } = weekOf(now);
    const weekendDays = EVERY_DAY.filter((weekday) => !week.includes(weekday));
    const byPerson = new Map();
    plans.forEach((plan) => {
        const task = open.get(String(plan.TaskId));
        const minutes = Number(plan.EstimatedTime) || 0;
        const at = time(plan.Date);
        if (!task || minutes <= 0 || !(at >= start.getTime() && at < end.getTime() + DAY_MS)) return;
        const person = String(plan.UserId);
        const held = byPerson.get(person) || { minutes: 0, perTask: new Map() };
        held.minutes += minutes;
        held.perTask.set(idOf(task), (held.perTask.get(idOf(task)) || 0) + minutes);
        byPerson.set(person, held);
    });
    return [...byPerson].map(([userId, held]) => {
        const capacityHours = ptoRules.computeAvailableCapacity({
            rangeStart: start, rangeEnd: end, ptoEntries: pto.filter((entry) => String(entry.userId) === userId), workingHoursPerDay: HOURS_PER_DAY, weekendDays,
        }).availableHours;
        const plannedHours = Math.round(held.minutes / 6) / 10;
        if (plannedHours <= capacityHours) return null;
        const [largest] = [...held.perTask].sort((a, b) => b[1] - a[1])[0];
        return {
            rule: RULE.OVERLOADED, key: `overloaded:${userId}:${ymd(start)}`, userId, taskId: largest, taskIds: [...held.perTask.keys()], weight: plannedHours - capacityHours,
            facts: { ...refOf(open.get(largest)), plannedHours, capacityHours },
        };
    }).filter(Boolean);
};

const byUrgency = (a, b) => MOST_URGENT_FIRST.indexOf(a.rule) - MOST_URGENT_FIRST.indexOf(b.rule) || b.weight - a.weight;

/* `tasks` are the project's own; `blockers` are tasks they wait on that were not among them. */
const findingsOf = ({ tasks = [], blockers = [], plans = [], pto = [], now, week }) => {
    const context = { now, week, window: riskWindow({ now, tzOffset: 0 }), byId: new Map([...blockers, ...tasks].map((task) => [idOf(task), task])) };
    const open = tasks.filter((task) => !isClosedTask(task));
    const aboutTasks = open.flatMap((task) => {
        const chain = [slipping(task, context), blocked(task, context)].filter(Boolean);
        const intake = untriaged(task);
        return [...chain, ...(intake ? [intake] : [noOwner(task), noEstimate(task)]), chain.length ? null : stale(task, context)].filter(Boolean);
    });
    const aboutPeople = overloaded({ open: new Map(open.map((task) => [idOf(task), task])), plans, pto, now, week });
    return [...aboutTasks, ...aboutPeople].sort(byUrgency);
};

module.exports = { RULE, MOST_URGENT_FIRST, STALE_WORKING_DAYS, QUIET_BLOCKER_WORKING_DAYS, HOURS_PER_DAY, isWorkingDay, workingDaysSince, weekOf, findingsOf };

const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { shiftDependants } = require('../Tasks/helpers/ganttShift');

/* A date change an agent makes moves the tasks waiting on the task the way the Gantt moves them when a person drags
 * it later (Modules/Tasks/helpers/ganttShift.js). Each waiting task is held to what a change of its own by the agent
 * would be: only one the person can open, inside the token's projects, in a project where the person may change dates
 * and whose rule for agents lets this change happen now. Any other stays where it is and is named as starting too early. */

const OBJECT_ID = /^[a-f0-9]{24}$/i;
/* bulkUpdateDates takes at most 500 rows: the moved task's chain is read that far. */
const limits = { chainMax: 500 };
const LIVE = { $nin: [1, 2, 3] };
const FIELDS = Object.freeze({ TaskName: 1, startDate: 1, DueDate: 1, relations: 1, ProjectID: 1, sprintId: 1, mainChat: 1, AssigneeUserId: 1 });
const DATES = Object.freeze({ startDate: true, DueDate: true });
const NO_RIGHT = 'the person may not change dates in its project';
const ROUNDS = 10;
const EARLIEST = new Date(0);

const idOf = (value) => (value === undefined || value === null ? '' : String(value));
const blocked = (task) => (Array.isArray(task.relations) ? task.relations : []).filter((entry) => entry && entry.type === 'blocks').map((entry) => idOf(entry.taskId));

/* The Gantt counts days on the person's own calendar; the server's clock is moved onto that wall time and back. */
const onWall = (value, zone) => {
    const at = DateTime.fromJSDate(new Date(value), { zone });
    return new Date(at.year, at.month - 1, at.day, at.hour, at.minute, at.second, at.millisecond);
};
const offWall = (date, zone) => DateTime.fromObject({
    year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(),
    hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds(), millisecond: date.getMilliseconds(),
}, { zone }).toUTC().toISO();

/* The projects the token behind this change is held to, as this request or MCP call was entered: null when it is not. */
const heldTo = (uid) => {
    const held = require('../../event/writerLimits').ofThisRequest();
    return held && String(held.userId) === uid && Array.isArray(held.projectIds) && held.projectIds.length ? held.projectIds.map((id) => String(id).toLowerCase()) : null;
};

const chainOf = async (companyId, uid, task) => {
    const { readableTasks } = require('../Tasks/helpers/taskReadAccess');
    const within = heldTo(uid);
    const found = new Map([[idOf(task._id), task]]);
    let level = blocked(task);
    let truncated = false;
    while (level.length) {
        const wanted = [...new Set(level)].filter((id) => OBJECT_ID.test(id) && !found.has(id));
        if (!wanted.length) break;
        const room = limits.chainMax - found.size;
        if (wanted.length > room) truncated = true;
        if (room <= 0) break;
        // eslint-disable-next-line no-await-in-loop
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS, data: [{ _id: { $in: wanted.slice(0, room).map((id) => new mongoose.Types.ObjectId(id)) }, deletedStatusKey: LIVE, mainChat: { $ne: true } }, FIELDS],
        }, 'find') || [];
        // eslint-disable-next-line no-await-in-loop
        const opened = (await readableTasks(companyId, uid, rows)).filter((row) => !within || within.includes(idOf(row.ProjectID).toLowerCase()));
        opened.forEach((row) => found.set(idOf(row._id), row));
        level = opened.flatMap(blocked);
    }
    return { chain: [...found.values()], truncated };
};

/* Whether the person may change dates is a rule of each project, asked once a project. */
const projectsAllowing = async (companyId, actor, rows) => {
    const { holderMay } = require('./permissions');
    const allowed = new Set();
    for (const projectId of [...new Set(rows.map((row) => idOf(row.ProjectID)))]) {
        // eslint-disable-next-line no-await-in-loop
        if ((await holderMay(companyId, actor, 'task.edit', { projectId, fields: DATES })).allowed) allowed.add(projectId);
    }
    return allowed;
};

/* What moving `task` from its stored dates to `to` asks of the tasks waiting on it: the rows to write, what each
 * held before, and the answer. Null when the move pushes nothing later. With `linkedTo`, `task` was just linked as
 * blocking that task, and the link is what pushes it later. `applying` takes each moved task's place in its
 * project's count of an agent's direct changes, as a change of its own would; `approved` is a person's approval
 * of this change, which the card showed these moves on. */
const plan = async ({ companyId, actor, uid, task, to, zone, approved = false, applying = true, linkedTo = '' }) => {
    const start = to.startDate || task.startDate;
    const end = to.DueDate === undefined ? task.DueDate : to.DueDate;
    const pushesLater = Boolean(linkedTo) || new Date(end) > new Date(task.DueDate);
    if (!task.startDate || !task.DueDate || !start || !end || !pushesLater || !blocked(task).length) return null;

    const { chain, truncated } = await chainOf(companyId, uid, task);
    if (chain.length < 2) return null;
    const movedId = idOf(task._id);
    const byId = new Map(chain.map((row) => [idOf(row._id), row]));
    const allowed = await projectsAllowing(companyId, actor, chain.filter((row) => idOf(row._id) !== movedId));
    const held = new Map(chain.filter((row) => idOf(row._id) !== movedId && !allowed.has(idOf(row.ProjectID))).map((row) => [idOf(row._id), NO_RIGHT]));
    const { workingDaysOf } = require('../Company/helpers/companyWeek');
    const workingDays = await workingDaysOf(companyId, idOf(task.ProjectID));
    const projectPolicy = require('./projectPolicy');
    const asked = new Map();
    const ruleFor = async (id, counted) => {
        const key = `${id}:${counted}`;
        if (!asked.has(key)) {
            asked.set(key, await projectPolicy.ask({ companyId, actor, action: 'task.edit', params: { taskId: id, fields: DATES }, approved, applying: counted }));
        }
        return asked.get(key);
    };
    // A new link counts as the blocker arriving where it already is, pushing only the task it was just linked to and
    // what waits on that one: an overlap with another task it blocked before is not this link's doing.
    const placed = (row) => (linkedTo && idOf(row._id) === movedId ? { startDate: EARLIEST, DueDate: EARLIEST } : row);
    const counts = (source, target) => !linkedTo || source !== movedId || target === idOf(linkedTo);
    const shiftNow = () => shiftDependants(
        chain.map((row) => ({ id: idOf(row._id), startDate: placed(row).startDate && onWall(placed(row).startDate, zone), DueDate: placed(row).DueDate && onWall(placed(row).DueDate, zone) })),
        chain.flatMap((row) => blocked(row).filter((id) => byId.has(id) && counts(idOf(row._id), id)).map((target) => ({ source: idOf(row._id), target }))),
        movedId,
        { startDate: onWall(start, zone), DueDate: onWall(end, zone) },
        { workingDays, canEdit: (id) => !held.has(id) },
    );

    let shift = shiftNow();
    for (const counted of [false, applying]) {
        for (let round = 0; round < ROUNDS; round += 1) {
            let changed = false;
            for (const entry of shift.shifts) {
                // eslint-disable-next-line no-await-in-loop
                const rule = await ruleFor(entry.id, counted);
                if (rule.decision !== projectPolicy.DECISION.ACT) { held.set(entry.id, rule.reason); changed = true; }
            }
            if (!changed) break;
            shift = shiftNow();
        }
    }

    const titleOf = (id) => byId.get(id).TaskName || '';
    const moved = shift.shifts.map((entry) => ({
        taskId: entry.id, title: titleOf(entry.id), startDate: offWall(entry.to.startDate, zone), dueDate: offWall(entry.to.DueDate, zone), workingDays: entry.days,
    }));
    return {
        rows: moved.map((entry) => ({ taskId: entry.taskId, startDate: entry.startDate, DueDate: entry.dueDate })),
        before: moved.map((entry) => ({
            taskId: entry.taskId, startDate: byId.get(entry.taskId).startDate || null, DueDate: byId.get(entry.taskId).DueDate || null,
            movedStart: entry.startDate, movedDue: entry.dueDate,
        })),
        answer: {
            moved,
            startTooEarly: shift.conflicts.map((entry) => ({ taskId: entry.id, title: titleOf(entry.id), workingDays: entry.days, why: held.get(entry.id) || NO_RIGHT })),
            ...(shift.cycle.length ? { loop: shift.cycle.map(titleOf) } : {}),
            ...(truncated ? { truncated: true, considered: chain.length - 1, limit: limits.chainMax - 1 } : {}),
        },
    };
};

module.exports = { plan, limits };

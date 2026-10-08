const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { shiftDependants } = require('../Tasks/helpers/ganttShift');

/* A date change an agent makes moves the tasks waiting on the task the way the Gantt moves them when a person drags
 * it later (Modules/Tasks/helpers/ganttShift.js): only tasks the person can open are read or moved, and one the
 * person may not change the dates of stays where it is and is named as starting too early. */

const OBJECT_ID = /^[a-f0-9]{24}$/i;
/* bulkUpdateDates takes at most this many rows. */
const CHAIN_MAX = 500;
const LIVE = { $nin: [1, 2, 3] };
const FIELDS = Object.freeze({ TaskName: 1, startDate: 1, DueDate: 1, relations: 1, ProjectID: 1, sprintId: 1, mainChat: 1, AssigneeUserId: 1 });

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

const chainOf = async (companyId, uid, task) => {
    const { readableTasks } = require('../Tasks/helpers/taskReadAccess');
    const found = new Map([[idOf(task._id), task]]);
    let level = blocked(task);
    while (level.length && found.size < CHAIN_MAX) {
        const wanted = [...new Set(level)].filter((id) => OBJECT_ID.test(id) && !found.has(id)).slice(0, CHAIN_MAX - found.size);
        if (!wanted.length) break;
        // eslint-disable-next-line no-await-in-loop
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS, data: [{ _id: { $in: wanted.map((id) => new mongoose.Types.ObjectId(id)) }, deletedStatusKey: LIVE, mainChat: { $ne: true } }, FIELDS],
        }, 'find') || [];
        // eslint-disable-next-line no-await-in-loop
        const opened = await readableTasks(companyId, uid, rows);
        opened.forEach((row) => found.set(idOf(row._id), row));
        level = opened.flatMap(blocked);
    }
    return [...found.values()];
};

const mayMove = async (companyId, actor, rows) => {
    const { holderMay } = require('./permissions');
    const allowed = new Set();
    for (const row of rows) {
        // eslint-disable-next-line no-await-in-loop
        const held = await holderMay(companyId, actor, 'task.edit', { taskId: idOf(row._id), fields: { startDate: true, DueDate: true } });
        if (held.allowed) allowed.add(idOf(row._id));
    }
    return allowed;
};

/* What moving `task` from its stored dates to `to` asks of the tasks waiting on it: the rows to write, the tasks
 * moved and those left starting too early. Null when the move pushes nothing later. */
const plan = async ({ companyId, actor, uid, task, to, zone }) => {
    const start = to.startDate || task.startDate;
    const end = to.DueDate === undefined ? task.DueDate : to.DueDate;
    if (!task.startDate || !task.DueDate || !start || !end || new Date(end) <= new Date(task.DueDate) || !blocked(task).length) return null;

    const chain = await chainOf(companyId, uid, task);
    if (chain.length < 2) return null;
    const movedId = idOf(task._id);
    const allowed = await mayMove(companyId, actor, chain.filter((row) => idOf(row._id) !== movedId));
    const { workingDaysOf } = require('../Company/helpers/companyWeek');
    const workingDays = await workingDaysOf(companyId, idOf(task.ProjectID));
    const byId = new Map(chain.map((row) => [idOf(row._id), row]));
    const shift = shiftDependants(
        chain.map((row) => ({ id: idOf(row._id), startDate: row.startDate && onWall(row.startDate, zone), DueDate: row.DueDate && onWall(row.DueDate, zone) })),
        chain.flatMap((row) => blocked(row).filter((id) => byId.has(id)).map((target) => ({ source: idOf(row._id), target }))),
        movedId,
        { startDate: onWall(start, zone), DueDate: onWall(end, zone) },
        { workingDays, canEdit: (id) => allowed.has(id) },
    );
    const titleOf = (id) => byId.get(id).TaskName || '';
    const moved = shift.shifts.map((entry) => ({
        taskId: entry.id, title: titleOf(entry.id), startDate: offWall(entry.to.startDate, zone), dueDate: offWall(entry.to.DueDate, zone), workingDays: entry.days,
    }));
    return {
        rows: moved.map((entry) => ({ taskId: entry.taskId, startDate: entry.startDate, DueDate: entry.dueDate })),
        before: moved.map((entry) => ({ taskId: entry.taskId, startDate: byId.get(entry.taskId).startDate || null, DueDate: byId.get(entry.taskId).DueDate || null })),
        answer: {
            moved,
            startTooEarly: shift.conflicts.map((entry) => ({ taskId: entry.id, title: titleOf(entry.id), workingDays: entry.days })),
            ...(shift.cycle.length ? { loop: shift.cycle.map(titleOf) } : {}),
        },
    };
};

module.exports = { plan, CHAIN_MAX };

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { CLOSED_STATUS_TYPES, isClosedTask } = require('../../Tasks/helpers/taskSignals');

// What the dry run and the backtest say about the two triggers no write publishes:
// whether one stored task is in the state the trigger fires on, and which stored
// tasks the trigger would have reached in the backtest window. Reads only.

const DUE_DATE_PASSED = 'task.due_date_passed';
const SUBTASKS_ALL_DONE = 'task.subtasks_all_done';
const SUBTASK_SCAN_LIMIT = 2000;
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const liveSubtasksOf = (parentIds) => ({ ParentTaskId: { $in: parentIds }, isParentTask: false, deletedStatusKey: 0 });

const dueDateState = (task, now) => {
    const due = task.DueDate ? new Date(task.DueDate).getTime() : NaN;
    if (!Number.isFinite(due)) return { wouldFire: false, reason: 'no_due_date' };
    if (isClosedTask(task)) return { wouldFire: false, reason: 'task_closed' };
    if (due > now.getTime()) return { wouldFire: false, reason: 'not_due_yet' };
    return { wouldFire: true, reason: 'due' };
};

const subtaskState = async (companyId, task) => {
    const subtasks = (await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS, data: [liveSubtasksOf([String(task._id)]), { statusType: 1, status: 1 }],
    }, 'find')) || [];
    const open = subtasks.filter((subtask) => !isClosedTask(subtask)).length;
    const counts = { open, total: subtasks.length };
    if (!subtasks.length) return { wouldFire: false, reason: 'no_subtasks', ...counts };
    return open ? { wouldFire: false, reason: 'subtasks_open', ...counts } : { wouldFire: true, reason: 'subtasks_done', ...counts };
};

/* null for a trigger that a write publishes: the dry run reads those as though the write had just happened. */
const of = async (companyId, event, task, now = new Date()) => {
    if (event === DUE_DATE_PASSED) return { event, ...dueDateState(task, now) };
    if (event === SUBTASKS_ALL_DONE) return { event, ...(await subtaskState(companyId, task)) };
    return null;
};

/* Parents with a subtask closed in the window and none open now, from the newest closed subtasks. */
const finishedParentIds = async (companyId, { since, projectIds }) => {
    const closed = (await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [
            { ProjectID: { $in: projectIds }, isParentTask: false, deletedStatusKey: 0, statusType: { $in: CLOSED_STATUS_TYPES }, updatedAt: { $gte: since } },
            { ParentTaskId: 1 },
            { sort: { updatedAt: -1 }, limit: SUBTASK_SCAN_LIMIT },
        ],
    }, 'find')) || [];
    const parents = [...new Set(closed.map((subtask) => String(subtask.ParentTaskId || '')).filter((id) => OBJECT_ID.test(id)))];
    if (!parents.length) return [];
    const stillOpen = (await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ ...liveSubtasksOf(parents), statusType: { $nin: CLOSED_STATUS_TYPES } }, { ParentTaskId: 1 }],
    }, 'find')) || [];
    const unfinished = new Set(stillOpen.map((subtask) => String(subtask.ParentTaskId)));
    return parents.filter((id) => !unfinished.has(id));
};

/* { key, text, match }: the stored tasks a backtest counts for `event`, before the rule's conditions narrow them. */
const backtestBasis = async (companyId, event, { since, projectIds, windowDays, now = new Date() }) => {
    if (event === DUE_DATE_PASSED) {
        return {
            key: 'due_date_passed',
            text: `open tasks whose due date passed in the last ${windowDays} days and whose current state matches these conditions`,
            match: { deletedStatusKey: 0, DueDate: { $gte: since, $lte: now }, statusType: { $nin: CLOSED_STATUS_TYPES } },
        };
    }
    if (event === SUBTASKS_ALL_DONE) {
        const parents = await finishedParentIds(companyId, { since, projectIds });
        return {
            key: 'subtasks_all_done',
            text: `tasks whose subtasks are all done, one of them touched in the last ${windowDays} days, and whose current state matches these conditions`,
            match: { deletedStatusKey: 0, _id: { $in: parents.map((id) => new mongoose.Types.ObjectId(id)) } },
        };
    }
    return {
        key: 'touched',
        text: `tasks touched in the last ${windowDays} days whose current state matches these conditions`,
        match: { deletedStatusKey: { $ne: 1 }, updatedAt: { $gte: since } },
    };
};

module.exports = { of, backtestBasis, SUBTASK_SCAN_LIMIT };

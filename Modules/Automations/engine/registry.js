const setStatus = require('./actions/setStatus');
const setPriority = require('./actions/setPriority');
const addComment = require('./actions/addComment');
const createSubtaskAction = require('./actions/createSubtask');
const runAgent = require('./actions/runAgent');
const { COMPARISON_OPS, CHANGE_OPS, LOGICAL_OPS } = require('./expression');

// The manifest the builder UI renders itself from.
//
// This is the load-bearing idea of the whole feature: if the Vue builder draws
// its forms from this document, shipping a new action is one file here and zero
// frontend changes. If instead each action needs a hand-written form, the action
// library stops growing at about a dozen — which is the state the old stub was in.

const ACTIONS = [setStatus, setPriority, addComment, createSubtaskAction, runAgent];
const ACTIONS_BY_KEY = new Map(ACTIONS.map((a) => [a.key, a]));

/* Event types the bus can emit today, with whether they carry a field diff.
 * `hasDiff:false` on a trigger means a `changedTo` condition can never match, and
 * the rule validator uses that to reject the pairing at save time. */
const TRIGGERS = [
    { key: 'task.created', label: 'Task is created', entity: 'task', hasDiff: false },
    { key: 'task.status_changed', label: 'Task status changes', entity: 'task', hasDiff: true },
    { key: 'task.assignee_changed', label: 'Task assignee changes', entity: 'task', hasDiff: true },
    { key: 'task.priority_changed', label: 'Task priority changes', entity: 'task', hasDiff: true },
    { key: 'task.lead_changed', label: 'Task lead changes', entity: 'task', hasDiff: true },
    { key: 'task.due_date_changed', label: 'Task due date changes', entity: 'task', hasDiff: true },
    { key: 'task.renamed', label: 'Task is renamed', entity: 'task', hasDiff: true },
    { key: 'task.sprint_changed', label: 'Task moves sprint', entity: 'task', hasDiff: true },
    { key: 'task.updated', label: 'Task is updated (any field)', entity: 'task', hasDiff: true },
];

/* Fields a condition may read, with the operators that make sense for each — so
 * the builder offers "is empty" for assignees and "greater than" for subtask
 * counts, rather than every operator against every field. */
const CONDITION_FIELDS = [
    { field: 'statusType', label: 'Status', type: 'status', ops: ['eq', 'neq', 'in', 'notIn', 'changed', 'changedTo', 'changedFrom'] },
    { field: 'Task_Priority', label: 'Priority', type: 'select', options: ['LOW', 'MEDIUM', 'HIGH'], ops: ['eq', 'neq', 'in', 'notIn', 'changed', 'changedTo', 'changedFrom'] },
    { field: 'taskType', label: 'Task type', type: 'task_type', ops: ['eq', 'neq', 'in', 'notIn'] },
    { field: 'AssigneeUserId', label: 'Assignees', type: 'user_multi', ops: ['contains', 'empty', 'notEmpty', 'changed'] },
    { field: 'Task_Leader', label: 'Task lead', type: 'user', ops: ['eq', 'neq', 'empty', 'notEmpty', 'changed'] },
    { field: 'TaskName', label: 'Title', type: 'text', ops: ['contains', 'eq', 'neq', 'changed'] },
    { field: 'isParentTask', label: 'Is a parent task', type: 'boolean', ops: ['eq'] },
];

/* Strip the run function — the manifest is data for the client, and shipping a
 * function reference would only serialise as null anyway. */
const describeAction = (action) => ({
    key: action.key,
    label: action.label,
    appliesTo: action.appliesTo,
    scopes: action.scopes,
    schema: action.schema,
});

const manifest = () => ({
    triggers: TRIGGERS,
    conditionFields: CONDITION_FIELDS,
    operators: { logical: LOGICAL_OPS, comparison: COMPARISON_OPS, change: CHANGE_OPS },
    actions: ACTIONS.map(describeAction),
});

const getAction = (key) => ACTIONS_BY_KEY.get(String(key)) || null;
const hasAction = (key) => ACTIONS_BY_KEY.has(String(key));
const actionKeys = () => ACTIONS.map((a) => a.key);
const getTrigger = (key) => TRIGGERS.find((t) => t.key === String(key)) || null;

module.exports = { manifest, getAction, hasAction, actionKeys, getTrigger, describeAction, TRIGGERS, CONDITION_FIELDS };

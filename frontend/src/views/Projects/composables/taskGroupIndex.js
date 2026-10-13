/* What a task view sends to the routes that keep a task's position in its group.
 * CommonJS so the jest suite builds its fixture bodies with the function the views send them with. */

/* The groups the server keeps a position for; a custom field group has none of its own. */
const GROUP_INDEXES = Object.freeze({
    statusKey: 'groupByStatusIndex',
    Task_Priority: 'groupByPriorityIndex',
    AssigneeUserId: 'groupByAssigneeIndex',
    DueDate: 'groupByDueDateIndex'
});

const UNASSIGNED = '[]';

/* A person's group holds its member as a one-item list; the routes compare one plain value and refuse a list. */
const plainGroupValue = (value) => {
    if (!Array.isArray(value)) return value;
    return value.length ? value[0] : UNASSIGNED;
};

/* The on-load route needs a readable task.task_list, so a viewer without one would be refused on every open. */
const mayRead = (permission) => permission !== null && permission !== undefined && permission !== false && permission !== 0;

const missesIndex = (task, indexName) => (task[indexName] === undefined || task[indexName] === null) && task.TaskKey !== '--';

/* A group also carries the query its rows are fetched with and the rows already loaded. The route
 * refuses a body holding query operators, so only the three values that name the group are sent. */
function indexRepairRows(tasks, group, taskListPermission) {
    if (!group || !mayRead(taskListPermission) || GROUP_INDEXES[group.searchKey] !== group.indexName) return [];
    const item = { indexName: group.indexName, searchKey: group.searchKey, searchValue: plainGroupValue(group.searchValue) };
    return (tasks || [])
        .filter((task) => missesIndex(task, group.indexName))
        .map((task) => ({ data: task._id, item, taskKey: task.TaskKey }));
}

const indexRepairBody = (row, companyId) => ({ taskUpdate: row, companyId });

module.exports = { GROUP_INDEXES, plainGroupValue, indexRepairRows, indexRepairBody };

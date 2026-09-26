const assigneeIds = (task) => {
    const ids = task?.AssigneeUserId;
    if (Array.isArray(ids)) return ids.map(String);
    return ids ? [String(ids)] : [];
};

/* Bounds mirror dueDateCondition in taskGroups.js, so a row sits in the same bucket the
   server counted it in. */
function dueDateMatches(task, item) {
    if (!task.DueDate) return item.operation === "non";
    const seconds = new Date(task.DueDate).getTime() / 1000;
    switch (item.operation) {
        case "range":
            return seconds >= item.seconds && seconds < item.endSeconds;
        case "lt":
            return seconds <= item.seconds;
        case "gt":
            return seconds >= item.seconds;
        default:
            return false;
    }
}

/* An assignee group holds every task that person is on, directly or through a team, so a
   shared task appears under each of its assignees; the group with no value holds the
   unassigned tasks. */
export function taskInGroup(task, item) {
    if (item.searchKey === "DueDate") return dueDateMatches(task, item);
    if (item.searchKey === "AssigneeUserId") {
        const ids = assigneeIds(task);
        if (!item.value) return ids.length === 0;
        const groupIds = [String(item.value), ...(item.teamIds || [])];
        return ids.some((id) => groupIds.includes(id));
    }
    return task[item.searchKey] === item.searchValue;
}

export function groupLabel(item) {
    if (item?.searchKey !== "AssigneeUserId") return item?.name;
    const names = (item.users || []).map((user) => user?.Employee_Name).filter(Boolean);
    return names.length ? names.join(", ") : item.name;
}

export function listSourceTasks({ searched, searchedTasks, storeTasks, sprintId }) {
    if (!searched) return storeTasks || [];
    return (searchedTasks || []).filter((task) => task.sprintId === sprintId);
}

const isVisible = (task, showArchived) => (showArchived ? task.deletedStatusKey === 2 : !task.deletedStatusKey);

export function groupRows(tasks, item, showArchived) {
    const index = (task) => Number(task[item.indexName]) || 0;
    return (tasks || [])
        .filter((task) => isVisible(task, showArchived) && taskInGroup(task, item))
        .sort((a, b) => index(a) - index(b));
}

export const groupCountKey = (item) => `${item?.searchKey}_${item?.searchValue}`;

export function groupCountsFor(tasks, items, showArchived) {
    return Object.fromEntries((items || []).map((item) => [groupCountKey(item), groupRows(tasks, item, showArchived).length]));
}

export const searchExpandIds = (rows) => (rows || []).filter((task) => task.subtaskArray?.length).map((task) => String(task._id));

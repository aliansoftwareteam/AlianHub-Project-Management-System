import { customGroupMatches } from "@/views/Projects/composables/customFieldQuery";
import { inList } from "@/store/ProjectData/listMembership";

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
    if (item.customFieldId) return customGroupMatches(task, item);
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
    return (searchedTasks || []).filter((task) => inList(task, sprintId));
}

const isVisible = (task, showArchived) => (showArchived ? task.deletedStatusKey === 2 : !task.deletedStatusKey);

const timeOf = (value) => {
    if (!value) return 0;
    const time = value.seconds ? value.seconds * 1000 : new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
};

/* A task without the index sorts first, as a missing field does in MongoDB. */
const indexOf = (index) => (index === null || index === undefined || Number.isNaN(Number(index)) ? -Infinity : Number(index));

const orderKey = (index, createdAt, id) => [indexOf(index), timeOf(createdAt), String(id ?? "")];

function compareKeys(a, b) {
    for (let at = 0; at < a.length; at += 1) {
        if (a[at] !== b[at]) return a[at] > b[at] ? 1 : -1;
    }
    return 0;
}

/* The order the server pages a group in (getPaginatedTasks sorts by the group's index, then
   createdAt, then _id), so rows sit where the next page expects them and ties never shuffle. */
export const pageOrder = (indexName) => (a, b) => compareKeys(
    orderKey(a[indexName], a.createdAt, a._id),
    orderKey(b[indexName], b.createdAt, b._id)
);

/* How many loaded rows the server has already paged past: the rows up to the last one a page
   brought. Rows that left the group no longer count, and a row beyond that point (a new task,
   one a socket event added) is not counted either, so the next page starts where the last ended. */
export function pagedPast(rows, frontier, indexName) {
    if (!frontier) return null;
    const last = orderKey(frontier.index, frontier.createdAt, frontier._id);
    return (rows || []).filter((row) => compareKeys(orderKey(row[indexName], row.createdAt, row._id), last) <= 0).length;
}

export function groupRows(tasks, item, showArchived) {
    return (tasks || [])
        .filter((task) => isVisible(task, showArchived) && taskInGroup(task, item))
        .sort(pageOrder(item.indexName));
}

export const groupCountKey = (item) => `${item?.searchKey}_${item?.searchValue}`;

export function groupCountsFor(tasks, items, showArchived) {
    return Object.fromEntries((items || []).map((item) => [groupCountKey(item), groupRows(tasks, item, showArchived).length]));
}

export const searchExpandIds = (rows) => (rows || []).filter((task) => task.subtaskArray?.length).map((task) => String(task._id));

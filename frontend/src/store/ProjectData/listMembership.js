import { extraListsOf } from "@taskExtraListsRules";
import { locate, parentIdOf } from "./taskTree";

/* Which rows a list holds. A task lives in one list and may be added to others, so a list's bucket
 * holds its own tasks and the tasks added to it. Rows that live in another project are not drawn
 * in a list yet, so they are never kept. */

const same = (a, b) => String(a ?? "") === String(b ?? "");

export const livesIn = (row, sprintId) => same(row?.sprintId, sprintId);

export const isAddedTo = (row, sprintId) => extraListsOf(row).some((entry) => same(entry.sprintId, sprintId));

/* The rule a search result is sorted into lists by: the same row matches under its home and under each list it was added to. */
export const inList = (row, sprintId) => livesIn(row, sprintId) || isAddedTo(row, sprintId);

const inProject = (row, pid) => row.ProjectID === undefined || same(row.ProjectID, pid);

/* Whether a change may have altered the rows some list shows of another project's tasks: the task
 * lives in another project than the list it reached, it is in a list of another project, or its
 * lists were just changed. */
export function touchesOtherProjects(row, pid, updatedFields) {
    if (!row) return false;
    return !inProject(row, pid) || Boolean(updatedFields?.extraLists) || extraListsOf(row).some((entry) => !same(entry.projectId, pid));
}

/* A payload that names no list (a partial update) says nothing either way, and a subtask sits
 * where its parent does: both are shown wherever the store already holds them. */
const placedByItself = (row) => row?.sprintId !== undefined && parentIdOf(row) === "";

export function shownInList(row, pid, sprintId) {
    if (!placedByItself(row) || livesIn(row, sprintId)) return true;
    return inProject(row, pid) && isAddedTo(row, sprintId);
}

/* An event for a task this list neither shows nor holds: it reached the list's room because the
 * task was added to the list from another project, or has just left it. */
export const isStranger = (bucket, row, pid, sprintId) => !shownInList(row, pid, sprintId) && !locate(bucket, row._id);

/* Whether a change took the row out of the list. A subtask goes when its home moves, as before;
 * a task goes when the list is no longer its home or one of its lists. */
export function leftList(row, pid, sprintId, updatedFields) {
    if (!row || row.sprintId === undefined || livesIn(row, sprintId)) return false;
    if (parentIdOf(row) !== "") return Boolean(updatedFields?.sprintId);
    if (shownInList(row, pid, sprintId)) return false;
    return Boolean(updatedFields?.sprintId || updatedFields?.extraLists) || !inProject(row, pid);
}

/* The other loaded lists of the project that hold the row, with whether each still shows it. A
 * person's own edit is written to the task's home bucket, and the row they are looking at may be
 * in the bucket of a list the task was added to. */
export function otherHolders(project, row, pid, sprintId) {
    return (project?.sprints || [])
        .filter((other) => !same(other, sprintId) && locate(project[other], row?._id))
        .map((other) => ({ sprintId: other, shown: shownInList(row, pid, other) }));
}

/* Subtasks are read where their parent lives, which for an added task is not the list on screen. */
export function homeListOf(state, pid, sprintId, taskId) {
    const row = locate(state.tasks?.[pid]?.[sprintId] || { tasks: [] }, taskId)?.row
        || locate({ tasks: state.tableTasks?.[pid]?.[sprintId]?.tasks || [] }, taskId)?.row;
    return row?.sprintId ? String(row.sprintId) : sprintId;
}

import { MAX_EXTRA_LISTS, REFUSALS, canAddToList, canBeExtraList, canHoldExtraLists, extraListsOf, isScrumList } from "@taskExtraListsRules";

const MOVE = "task.task_move";
const ROUTE_REFUSALS = ["TASK_NOT_FOUND", "LIST_NOT_FOUND", "NOT_IN_LIST", "NOT_PERMITTED", "TASK_CHANGED"];

export { MAX_EXTRA_LISTS };

export const REFUSAL_CODES =[...Object.keys(REFUSALS), ...ROUTE_REFUSALS];

/* The entry set moved under the request, so the names on screen are read again. */
export const STALE_CODES = ["ALREADY_IN_LIST", "HOME_LIST", "NOT_IN_LIST", "TASK_CHANGED", "TOO_MANY_LISTS"];

const idOf = (row) => String((row && (row._id || row.id)) || "");

export const storedEntries = (task) => extraListsOf(task).map((entry) => ({ projectId: String(entry.projectId), sprintId: String(entry.sprintId) }));

export const signatureOf = (taskId, entries) => `${taskId || ""}:${(entries || []).map((entry) => String(entry.sprintId)).join(",")}`;

/* A missing task answers 404 with no code, exactly as one the caller cannot read. */
export function refusalCodeOf(answer) {
    const response = (answer && answer.response) || answer || {};
    const code = response.data && response.data.code;
    if (code) return String(code);
    return response.status === 404 ? "TASK_NOT_FOUND" : "";
}

export const refusalKey = (code) => `TaskLists.refusal_${REFUSAL_CODES.includes(code) ? code.toLowerCase() : "unknown"}`;

export function canAddLists(task, project, entries, check) {
    return Boolean(task && task._id && project && project._id)
        && canHoldExtraLists(task, project).ok
        && (entries || []).length < MAX_EXTRA_LISTS
        && check(MOVE, project) === true;
}

export function addTargets(projects, check) {
    return (projects || []).filter((project) => canBeExtraList({}, project).ok && check(MOVE, project) === true);
}

/* The lists any task could be added to; which of several tasks a list already holds is for the server to say. */
export const offersAnyTask = (list) => !list.deletedStatusKey && !isScrumList(list);

export const offersList = (task, entries) => (list) => offersAnyTask(list)
    && canAddToList({ sprintId: task.sprintId, extraLists: entries }, idOf(list)).ok;

/* The server lets an entry go by the right to move the task at its home, or by the same right in the list's project. */
export function canRemoveEntry(entry, { home, projects, check }) {
    if (!entry || entry.name === undefined) return false;
    if (check(MOVE, home) === true) return true;
    const there = (projects || []).find((project) => idOf(project) === String(entry.projectId));
    return Boolean(there) && check(MOVE, there) === true;
}

import { livesIn } from "@/store/ProjectData/listMembership";

const same = (a, b) => String(a ?? "") === String(b ?? "");

/* Whether the row is shown in a list it was added to, rather than in the list it lives in. */
export const isAddedRow = (task, listId) => Boolean(listId) && Boolean(task) && task.isParentTask !== false
    && task.sprintId !== undefined && !livesIn(task, listId);

/* Where a row shown in a list it was added to lives: the name its own row carries for its home
 * list, and its project when that is not the one on screen. Null for a row that lives here. */
export function homeOf(task, list, projects = []) {
    if (!isAddedRow(task, list?.sprintId)) return null;
    const elsewhere = Boolean(list.projectId) && task.ProjectID !== undefined && !same(task.ProjectID, list.projectId);
    const project = elsewhere ? (projects || []).find((item) => same(item._id, task.ProjectID)) : null;
    return { list: task.sprintArray?.name || "", elsewhere, project: project?.ProjectName || "" };
}

/* A drag the view refuses has already moved the card in the list the view draws from. */
export function putBack(rows, { element, oldIndex, newIndex } = {}) {
    if (!Array.isArray(rows) || rows[newIndex] !== element) return;
    rows.splice(newIndex, 1);
    rows.splice(oldIndex, 0, element);
}

export function homeMarkText(home, t) {
    if (!home) return null;
    if (home.elsewhere && !home.project) return { name: t("TaskLists.another_project"), title: t("TaskLists.lives_in_another_project") };
    if (!home.list) return { name: t("TaskLists.another_list"), title: t("TaskLists.lives_in_another_list") };
    if (home.elsewhere) return { name: home.list, title: t("TaskLists.lives_in_project", { list: home.list, project: home.project }) };
    return { name: home.list, title: t("TaskLists.lives_in", { list: home.list }) };
}

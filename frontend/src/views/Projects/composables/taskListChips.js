import { extraListsOf } from "@taskExtraListsRules";

export const CHIP_CAP = 2;

/* The server names an entry only for a list this person can open. An unnamed one is neither
 * shown nor counted: a count would say the task is in a list they were not told about. */
export const openLists = (task) => extraListsOf(task).filter((entry) => entry.name !== undefined);

export function listChips(task, t, cap = CHIP_CAP) {
    const lists = openLists(task);
    const nameOf = (entry) => entry.name || t("TaskLists.another_list");
    const placeOf = (entry) => (entry.projectName && String(entry.projectId) !== String(task.ProjectID)
        ? t("TaskLists.list_in_project", { list: nameOf(entry), project: entry.projectName })
        : nameOf(entry));
    const rest = lists.length - Math.min(lists.length, cap);
    return {
        home: task?.sprintArray?.name || "",
        chips: lists.slice(0, cap).map((entry) => ({ id: String(entry.sprintId), name: nameOf(entry), title: t("TaskLists.also_in", { lists: placeOf(entry) }) })),
        more: rest > 0 ? { text: t("TaskLists.more_lists", { n: rest }), title: t("TaskLists.also_in", { lists: lists.map(placeOf).join(", ") }) } : null
    };
}

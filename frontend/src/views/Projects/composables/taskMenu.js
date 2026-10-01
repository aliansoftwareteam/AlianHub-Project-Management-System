import { rowEditRights } from "@/views/Projects/ListView/listRowEdit";

const hasKey = (task) => Boolean(task.TaskKey) && task.TaskKey !== "--";
const hasSubtasks = (task) => Number(task.subTasks || 0) > 0;

/* The task menu of the Board card and the List row: every item once, in the order shown,
 * with its label and the rule that decides whether a task gets it. Each view supplies only
 * what happens when an item is picked. */
export const TASK_MENU = Object.freeze([
    { id: "rename", labelKey: "List.menu_rename", group: "task", shown: ({ rights }) => rights.rename },
    { id: "subtask", labelKey: "List.menu_subtask", group: "task", shown: ({ rights, canNest }) => rights.subtask && canNest },
    { id: "copy-link", labelKey: "List.menu_copy_link", group: "task" },
    { id: "copy-key", labelKey: "List.menu_copy_key", group: "task", shown: ({ task }) => hasKey(task) },
    { id: "new-tab", labelKey: "List.menu_new_tab", group: "task" },
    { id: "open", labelKey: "List.menu_open", group: "task" },
    { id: "save-template", labelKey: "TaskTemplates.save_as", group: "task", shown: ({ rights, isSub }) => rights.template && !isSub },
    { id: "convert-subtask", labelKey: "ProjectDetails.convert_subtask", group: "change", shown: ({ rights, isSub }) => rights.convertSubtask && !isSub },
    { id: "convert-list", labelKey: "ProjectDetails.convert_list", group: "change", shown: ({ rights }) => rights.convertList },
    { id: "move", labelKey: "List.menu_move", group: "change", shown: ({ rights }) => rights.move },
    { id: "duplicate", labelKey: "List.menu_duplicate", group: "change", shown: ({ rights }) => rights.duplicate },
    { id: "duplicate-subtasks", labelKey: "List.menu_duplicate_subtasks", group: "change", shown: ({ rights, isSub, task }) => rights.duplicate && !isSub && hasSubtasks(task) },
    { id: "merge", labelKey: "ProjectDetails.merge", group: "change", shown: ({ rights }) => rights.merge },
    { id: "archive", labelKey: "List.menu_archive", group: "remove", shown: ({ rights, task }) => rights.archive && !task.deletedStatusKey },
    { id: "restore", labelKey: "Projects.restore", group: "remove", shown: ({ rights, task }) => rights.restore && task.deletedStatusKey === 2 },
    { id: "delete", labelKey: "List.menu_delete", group: "remove", danger: true, shown: ({ rights }) => rights.delete }
]);

/* `check` takes a full permission path. Only `=== true` grants: read access (false) and a
 * missing permission (null) both leave the item out. While the view shows archived tasks a
 * task can only be copied, opened, restored or deleted. */
export function taskMenuRights(check, { archived = false } = {}) {
    const yes = (path) => check(path) === true;
    const live = !archived;
    const { rename, subtask, template } = rowEditRights(check, { archived });
    return {
        rename,
        subtask,
        template,
        convertSubtask: live && yes("task.sub_task_create") && yes("task.task_convert_to_subtask"),
        convertList: live && yes("project.project_sprint_create") && yes("task.task_convert_to_list"),
        move: live && yes("task.task_move"),
        duplicate: live && yes("task.task_duplicate"),
        merge: live && yes("task.task_merge"),
        archive: live && yes("task.task_archive"),
        restore: archived && yes("task.task_archive"),
        delete: yes("task.task_delete")
    };
}

/* `canNest` says whether the task may take a subtask. A view that shows one level leaves it
 * out, and only a top-level task is offered one there. */
export function taskMenuItems(task, rights, { isSub = task?.isParentTask === false, canNest = !isSub } = {}) {
    const context = { task: task || {}, rights: rights || {}, isSub, canNest };
    let group = null;
    return TASK_MENU
        .filter((item) => !item.shown || item.shown(context))
        .map(({ id, labelKey, group: itemGroup, danger }) => {
            const separated = group !== null && itemGroup !== group;
            group = itemGroup;
            return { id, labelKey, danger: Boolean(danger), separated };
        });
}

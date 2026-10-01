import { creatableProjects } from "@/components/organisms/QuickCreateTask/quickCreateTask";
import { storedTasks } from "./bulkUndo.js";

const granted = (check, project, key) => check(key, project) === true;

/* The server's bulkMove asks for move (or status) rights in the destination; the picker
 * also asks for create rights, so it never offers a project you cannot add tasks to. */
export function moveTargets(projects, check) {
    return creatableProjects(projects, check)
        .filter((project) => granted(check, project, "task.task_move") || granted(check, project, "task.task_status"));
}

export function convertTargets(projects, check) {
    return creatableProjects(projects, check);
}

/* Where a subtask can be created, judged by the task rule with sub_task_create in place of task_create. */
export function parentTargets(projects, check) {
    const subtaskRights = (path, project) => check(path === "task.task_create" ? "task.sub_task_create" : path, project);
    return creatableProjects(projects, subtaskRights)
        .filter((project) => granted(check, project, "task.task_convert_to_subtask"));
}

/* A subtask whose parent is also selected travels with it, so only the others are loose. */
export function selectionShape(projectData, taskIds) {
    const wanted = new Set((taskIds || []).map(String));
    const found = new Map();
    for (const task of storedTasks(projectData)) {
        const id = String(task?._id || "");
        if (wanted.has(id) && !found.has(id)) found.set(id, task);
    }
    const subtasks = [...found.values()].filter((task) => task.isParentTask === false);
    const looseSubtasks = subtasks.filter((task) => !wanted.has(String(task.ParentTaskId || "")));
    return { count: wanted.size, subtasks: subtasks.length, looseSubtasks: looseSubtasks.length };
}

const on = { enabled: true };
const off = (reason) => ({ enabled: false, reason });

export function placementActions(shape, rights) {
    const onlyLooseSubtasks = shape.count > 0 && shape.looseSubtasks === shape.count;
    return {
        moveProject: !rights.move ? off("BulkActions.move_denied")
            : onlyLooseSubtasks ? off("BulkActions.subtask_moves_hint") : on,
        toSubtask: rights.toSubtask ? on : off("BulkActions.convert_denied"),
        toTask: !rights.toTask ? off("BulkActions.convert_denied")
            : shape.subtasks === 0 ? off("List.bulk_no_subtasks") : on
    };
}

const REASONS = {
    permission: "reason_permission",
    "not-found-or-cross-tenant": "reason_not_found_or_cross_tenant",
    "project-not-found": "reason_project_not_found",
    "invalid-id": "reason_invalid_id",
    "invalid-type": "reason_invalid_type",
    "already-in-target": "reason_already_in_target",
    "is-the-chosen-parent": "reason_is_the_chosen_parent",
    "already-a-subtask-of-this-parent": "reason_already_a_subtask_of_this_parent",
    "carried-with-its-parent": "reason_carried_with_its_parent",
    "already-a-top-level-task": "reason_already_a_top_level_task",
    "subtask-moves-with-its-parent": "reason_subtask_moves_with_its_parent"
};

function commonest(list) {
    const counts = new Map();
    list.forEach((entry) => counts.set(entry?.reason, (counts.get(entry?.reason) || 0) + 1));
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

/* Null when every task went through; otherwise the line that says what did not. */
export function bulkReport(result, t) {
    const skipped = Array.isArray(result?.skipped) ? result.skipped : [];
    const errors = Array.isArray(result?.errors) ? result.errors : [];
    if (!skipped.length && !errors.length) return null;
    const parts = [];
    if (skipped.length) {
        const key = REASONS[commonest(skipped)] || "reason_skipped";
        parts.push(t("BulkActions.result_skipped", { n: skipped.length, reason: t(`BulkActions.${key}`) }));
    }
    if (errors.length) parts.push(t("BulkActions.result_failed", { n: errors.length }));
    return parts.join(" — ");
}

export const NAV_ATTR = "data-task-nav";

/* Rows carry where their task lives, so the overlay walks exactly what the view shows:
 * its filter, its sort, its collapsed groups and whichever subtasks are expanded. */
export function taskNavAttrs(task, projectId = "") {
    if (!task || !task._id) return {};
    return {
        [NAV_ATTR]: String(task._id),
        "data-task-project": String(task.ProjectID || projectId || ""),
        "data-task-sprint": String(task.sprintId || ""),
        "data-task-folder": String(task.folderObjId || "")
    };
}

export function readSequence(root) {
    if (!root || typeof root.querySelectorAll !== "function") return [];
    const seen = new Set();
    const sequence = [];
    root.querySelectorAll(`[${NAV_ATTR}]`).forEach((el) => {
        const taskId = el.getAttribute(NAV_ATTR);
        if (!taskId || seen.has(taskId)) return;
        seen.add(taskId);
        sequence.push({
            taskId,
            projectId: el.getAttribute("data-task-project") || "",
            sprintId: el.getAttribute("data-task-sprint") || "",
            folderId: el.getAttribute("data-task-folder") || ""
        });
    });
    return sequence;
}

export function neighbours(sequence, taskId) {
    const index = (sequence || []).findIndex((item) => item.taskId === String(taskId));
    if (index === -1) return null;
    return {
        index,
        total: sequence.length,
        prev: sequence[index - 1] || null,
        next: sequence[index + 1] || null
    };
}

const EDITABLE = "input, textarea, select, [contenteditable]:not([contenteditable=\"false\"]), [role=\"textbox\"], [role=\"combobox\"], [role=\"searchbox\"]";
const LAYERS_ON_TOP = ".sidebar-main, .modal, .swal2-container, .dp__menu, [role=\"menu\"], [role=\"listbox\"]";

export function navKeyDirection(event) {
    if (!event || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return 0;
    const target = event.target && event.target.nodeType === 1 ? event.target : null;
    if (target && (target.isContentEditable || target.closest(EDITABLE) || target.closest(LAYERS_ON_TOP))) return 0;
    if (event.key === "j") return 1;
    if (event.key === "k") return -1;
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return 0;
    if (!target || !target.closest(".ah-detail__head")) return 0;
    return event.key === "ArrowDown" ? 1 : -1;
}

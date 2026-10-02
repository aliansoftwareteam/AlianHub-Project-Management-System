import { LEFT_BECAUSE } from "@taskTreeRules";
import { isOwnLeave } from "@/utils/taskUpdateMarker";

const LEFT_KEYS = {
    [LEFT_BECAUSE.MOVED]: "Toast.Task_was_moved",
    [LEFT_BECAUSE.SUBTASK]: "Toast.Task_became_subtask",
    [LEFT_BECAUSE.TASK]: "Toast.Subtask_became_task",
    [LEFT_BECAUSE.LIST]: "Toast.Task_became_list"
};

/* What the panel says as it closes on a task that left its list. '' for a move or a convert asked
   for in this tab: that action shows its own result. */
export function closingToastKey({ updatedFields, leftBecause }, taskId) {
    if (leftBecause) return isOwnLeave(taskId) ? "" : (LEFT_KEYS[leftBecause] || LEFT_KEYS[LEFT_BECAUSE.MOVED]);
    return updatedFields.deletedStatusKey === 1 ? "Toast.Task_deleted_successfully" : "Toast.Task_archived_successfully";
}

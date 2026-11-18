/* The counts document keys a task's unread comments by project, list and task; replies on its subtasks count under parentTask. */
export function unreadCommentsOf(counts, task) {
    if (!counts || !task?._id) return 0;
    const base = `${task.ProjectID}_${task.sprintId}_${task._id}_comments`;
    return (Number(counts[`task_${base}`]) || 0) + (Number(counts[`parentTask_${base}`]) || 0);
}

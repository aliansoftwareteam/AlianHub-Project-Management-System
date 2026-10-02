/* The key of the sentence a confirm shows before a task is archived or deleted: what happens to it, and to its subtasks. */
export const taskRemovalMessageKey = (task, archive) => {
    if (archive) return 'conformationmsg.archive_task';
    return Number(task?.subTasks) > 0 ? 'conformationmsg.delete_task_with_subtasks' : 'conformationmsg.delete_task';
};

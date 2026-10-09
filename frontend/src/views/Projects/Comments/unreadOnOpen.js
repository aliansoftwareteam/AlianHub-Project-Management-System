const TASK_ID = /^[0-9a-f]{24}$/i;

/* A task's comments opened in the panel are read; a chat channel keeps its count until the reader clicks in it. */
export function readsOnOpen({ taskId, mainChat = false, newChat = false, unread = 0 } = {}) {
    return !mainChat && !newChat && TASK_ID.test(String(taskId || "")) && Number(unread) > 0;
}

/* The "new" line stays where the unread comments began after the count is cleared, until the reader acts. */
export function dividerAfterCount({ divider = 0, count = 0, threadChanged = false } = {}) {
    if (count > 0) return count;
    return threadChanged ? 0 : divider;
}

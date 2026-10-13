export const TRAY_CAP = 8;

const TASK_ID = /^[a-f0-9]{24}$/i;
const DELETED = 1;

export const trayStorageKey = (userId, companyId) => (userId && companyId ? `ah:taskTray:${userId}:${companyId}` : "");

export function readTrayIds(key) {
    if (!key) return [];
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || "[]");
        if (!Array.isArray(parsed)) return [];
        const ids = [...new Set(parsed.filter((id) => typeof id === "string" && TASK_ID.test(id)))];
        return ids.slice(-TRAY_CAP);
    } catch {
        return [];
    }
}

export function writeTrayIds(key, ids) {
    if (!key) return;
    try {
        if (ids.length) localStorage.setItem(key, JSON.stringify(ids));
        else localStorage.removeItem(key);
    } catch {
        // Private mode or a full quota: the tray still works for this page's lifetime.
    }
}

/* Each id goes back through the normal task read, so access is checked again; a task
 * that is gone, deleted or no longer visible yields null and simply leaves the tray. */
export async function trayItemFor(taskId, companyId, fetchTask) {
    try {
        const task = await fetchTask(taskId);
        if (!task || String(task._id) !== taskId || task.deletedStatusKey === DELETED) return null;
        return {
            companyId: String(companyId || ""),
            projectId: String(task.ProjectID || ""),
            sprintId: String(task.sprintId || ""),
            folderId: task.folderObjId ? String(task.folderObjId) : "",
            taskId,
            taskKey: task.TaskKey || "",
            taskName: task.TaskName || ""
        };
    } catch {
        return null;
    }
}

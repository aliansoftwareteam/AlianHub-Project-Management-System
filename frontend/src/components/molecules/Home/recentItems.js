import { docRoute } from "@/components/molecules/Pages/docRoute";

export const RECENT_TYPES = Object.freeze(["task", "project", "doc", "sprint"]);

const textOf = (...values) => values.find((v) => typeof v === "string" && v.trim()) || "";
const idOf = (...values) => {
    const found = values.find((v) => v !== undefined && v !== null && v !== "");
    return found === undefined ? "" : String(found);
};

// Before the endpoint learned other types it answered { visitedAt, task }, so a row without a type is a task and its fields come from the task.
export function toRecentItem(visit) {
    if (!visit || typeof visit !== "object") return null;
    const type = visit.type || visit.entityType || "task";
    if (!RECENT_TYPES.includes(type)) return null;
    const route = visit.route && typeof visit.route === "object" ? visit.route : {};
    const task = type === "task" && visit.task && typeof visit.task === "object" ? visit.task : null;
    const id = idOf(visit.id, task?._id);
    if (!id) return null;

    const item = {
        type,
        id,
        visitedAt: visit.visitedAt || null,
        title: textOf(visit.title, task?.TaskName),
        code: textOf(task?.TaskKey),
        projectId: idOf(route.projectId, visit.projectId, task?.ProjectID, type === "project" ? id : ""),
        projectName: textOf(visit.projectName),
        folderId: idOf(route.folderId, task?.folderObjId),
    };
    if (type === "task") {
        item.task = task || { _id: idOf(route.taskId, id), ProjectID: item.projectId, sprintId: idOf(route.sprintId), folderObjId: item.folderId };
    }
    return item;
}

// Opening a project records the project and the sprint it lands on; the sprint row already says where that was.
export function toRecentItems(rows) {
    const items = (Array.isArray(rows) ? rows : []).map(toRecentItem).filter(Boolean);
    const sprintProjects = new Set(items.filter((item) => item.type === "sprint").map((item) => item.projectId));
    return items.filter((item) => item.type !== "project" || !sprintProjects.has(item.id));
}

export function recentRoute(item, cid) {
    if (item.type === "project") return { name: "Project", params: { cid, id: item.id } };
    if (item.type === "doc") return docRoute(cid, item.id);
    if (item.type === "sprint" && item.projectId) {
        return item.folderId
            ? { name: "ProjectFolderSprint", params: { cid, id: item.projectId, folderId: item.folderId, sprintId: item.id } }
            : { name: "ProjectSprint", params: { cid, id: item.projectId, sprintId: item.id } };
    }
    return null;
}

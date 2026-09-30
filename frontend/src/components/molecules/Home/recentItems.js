export const RECENT_TYPES = Object.freeze(["task", "project", "doc", "sprint"]);

const idOf = (entity) => String(entity?._id || entity?.id || "");
const textOf = (...values) => values.find((v) => typeof v === "string" && v.trim()) || "";

// The endpoint answered { visitedAt, task } before it learned other types, so an untyped visit is a task.
export function toRecentItem(visit) {
    if (!visit || typeof visit !== "object") return null;
    const type = visit.type || visit.entityType || "task";
    if (!RECENT_TYPES.includes(type)) return null;
    const entity = visit[type] || visit.item || visit.entity || null;
    const id = idOf(entity);
    if (!id) return null;

    const base = { type, id, visitedAt: visit.visitedAt || null };
    if (type === "task") {
        return { ...base, title: textOf(entity.TaskName, entity.name, entity.title), code: textOf(entity.TaskKey), task: entity };
    }
    if (type === "project") {
        return { ...base, title: textOf(entity.ProjectName, entity.name, entity.title), code: textOf(entity.ProjectCode) };
    }
    if (type === "doc") {
        return { ...base, title: textOf(entity.title, entity.name, entity.pageTitle), code: "" };
    }
    return {
        ...base,
        title: textOf(entity.name, entity.sprintName, entity.title),
        code: "",
        projectId: String(entity.projectId || entity.ProjectID || ""),
        folderId: String(entity.folderId || ""),
    };
}

export function recentRoute(item, cid) {
    if (item.type === "project") return { name: "Project", params: { cid, id: item.id } };
    if (item.type === "doc") return { name: "PageEditor", params: { cid, pageId: item.id } };
    if (item.type === "sprint" && item.projectId) {
        return item.folderId
            ? { name: "ProjectFolderSprint", params: { cid, id: item.projectId, folderId: item.folderId, sprintId: item.id } }
            : { name: "ProjectSprint", params: { cid, id: item.projectId, sprintId: item.id } };
    }
    return null;
}

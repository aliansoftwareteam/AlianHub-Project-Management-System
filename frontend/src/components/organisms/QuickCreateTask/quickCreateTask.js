import { reactive } from "vue";

const LAST_PROJECT_KEY = "ah.quickCreate.lastProject";
const DRAFT_KEY = "ah.quickCreate.draft";

export const quickCreate = reactive({ open: false, projectId: "", sprintId: "" });

export function openQuickCreate({ projectId = "", sprintId = "" } = {}) {
    quickCreate.projectId = projectId ? String(projectId) : "";
    quickCreate.sprintId = sprintId ? String(sprintId) : "";
    quickCreate.open = true;
}

export function closeQuickCreate() {
    quickCreate.open = false;
    quickCreate.projectId = "";
    quickCreate.sprintId = "";
}

const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

export function isEditableTarget(target) {
    if (!target || typeof target.closest !== "function") return false;
    if (target.isContentEditable || target.closest("[contenteditable=\"\"], [contenteditable=\"true\"]")) return true;
    const tag = String(target.tagName || "").toLowerCase();
    if (tag === "textarea" || tag === "select") return true;
    if (tag === "input") return !NON_TEXT_INPUTS.has(String(target.getAttribute("type") || "").toLowerCase());
    return false;
}

const OPEN_LAYERS = "[aria-modal=\"true\"], dialog[open], .ah-sheet__backdrop, .swal2-container";

export function hasOpenDialog(doc = typeof document === "undefined" ? null : document) {
    return Boolean(doc && doc.querySelector(OPEN_LAYERS));
}

export function isCreateTaskShortcut(event, { dialogOpen = false } = {}) {
    if (!event || event.defaultPrevented || event.isComposing || event.repeat) return false;
    if (event.key !== "c" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
    if (dialogOpen || isEditableTarget(event.target)) return false;
    return true;
}

/* Enter creates; Shift+Enter, or Enter with "Create another" on, creates and stays;
 * Cmd/Ctrl+Enter creates and opens the task. */
export function submitIntent(event, { keepOpen = false } = {}) {
    if (!event || event.key !== "Enter" || event.isComposing || event.altKey) return null;
    if (event.metaKey || event.ctrlKey) return "open";
    if (event.shiftKey || keepOpen) return "another";
    return "create";
}

const storageOf = (kind) => {
    try {
        return typeof window === "undefined" ? null : window[kind];
    } catch {
        return null;
    }
};

export function lastProjectKey(companyId, userId) {
    return `${LAST_PROJECT_KEY}.${companyId || ""}.${userId || ""}`;
}

export function readLastProject(companyId, userId, storage = storageOf("localStorage")) {
    try {
        return (storage && storage.getItem(lastProjectKey(companyId, userId))) || "";
    } catch {
        return "";
    }
}

export function rememberLastProject(companyId, userId, projectId, storage = storageOf("localStorage")) {
    try {
        if (storage && projectId) storage.setItem(lastProjectKey(companyId, userId), String(projectId));
    } catch {
        /* storage may be unavailable */
    }
}

export function readDraft(storage = storageOf("sessionStorage")) {
    try {
        return (storage && storage.getItem(DRAFT_KEY)) || "";
    } catch {
        return "";
    }
}

export function saveDraft(text, storage = storageOf("sessionStorage")) {
    try {
        if (!storage) return;
        const value = String(text || "").trim() ? String(text) : "";
        if (value) storage.setItem(DRAFT_KEY, value);
        else storage.removeItem(DRAFT_KEY);
    } catch {
        /* storage may be unavailable */
    }
}

const ready = (project) => Boolean(project
    && Array.isArray(project.taskStatusData) && project.taskStatusData.length
    && Array.isArray(project.taskTypeCounts) && project.taskTypeCounts.length);

const isOpen = (project) => project.statusType !== "close" && !project.deletedStatusKey;

/* The same rule the in-project add row applies (ListGroup's canCreate). `check(path, project)`
 * answers checkPermission against the rules that govern that project. */
export function canCreateTasksIn(project, check) {
    if (!ready(project) || !isOpen(project)) return false;
    if (check("task.task_create", project) !== true) return false;
    return project.isPersonal ? true : check("task.task_list", project) === true;
}

export function creatableProjects(projects, check) {
    const list = (projects || []).filter((p) => canCreateTasksIn(p, check));
    const personal = list.filter((p) => p.isPersonal);
    const others = list.filter((p) => !p.isPersonal).sort((a, b) => String(a.ProjectName || "").localeCompare(String(b.ProjectName || "")));
    return [...personal, ...others];
}

export function pickDefaultProject({ requestedId = "", routeProjectId = "", lastUsedId = "", projects = [] } = {}) {
    const has = (id) => id && projects.some((p) => String(p._id) === String(id));
    if (has(requestedId)) return String(requestedId);
    if (has(routeProjectId)) return String(routeProjectId);
    if (has(lastUsedId)) return String(lastUsedId);
    const personal = projects.find((p) => p.isPersonal);
    if (personal) return String(personal._id);
    return projects.length ? String(projects[0]._id) : "";
}

export function pickDefaultSprint(sprints, preferredId = "") {
    if (!sprints || !sprints.length) return "";
    const preferred = preferredId && sprints.find((s) => String(s.id) === String(preferredId));
    return String((preferred || sprints[0]).id);
}

export function defaultStatus(project) {
    const statuses = (project && project.taskStatusData) || [];
    return statuses.find((s) => s.type === "default_active") || statuses[0] || null;
}

export function hasPriorityApp(project, company) {
    const apps = (project && project.apps) || [];
    const on = apps.some((app) => app === "Priority" || (app && app.key === "Priority"));
    return Boolean(on && company && company.planFeature && company.planFeature.projectProjectApp);
}

/* A project's lists as the create dialog offers them: live lists only, and none from a
 * deleted folder. Accepts the sprint and folder documents the sprintFolder API returns. */
export function listsOf(sprintDocs, folderDocs = []) {
    const live = (x) => Number((x && x.deletedStatusKey) || 0) === 0;
    const liveFolders = new Map(folderDocs.filter(live).map((f) => [String(f._id || f.id), f.name || f.folderName || ""]));
    return (sprintDocs || [])
        .filter(live)
        .filter((s) => !s.folderId || !folderDocs.length || liveFolders.has(String(s.folderId)))
        .map((s) => ({
            id: String(s._id || s.id),
            name: s.name || "",
            value: s.value,
            folderId: s.folderId ? String(s.folderId) : "",
            folderName: s.folderId ? (liveFolders.get(String(s.folderId)) || s.folderName || "") : ""
        }));
}

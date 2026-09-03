import { reactive, computed } from "vue";

const TASK_QUERY = "task";

export const overlayState = reactive({
    open: false,
    current: null,
    tab: "",
    meta: {},
    minimized: [],
    hostMounted: 0
});

let router = null;
let route = null;
const closeListeners = new Set();

export function bindRouter(routerInstance, routeInstance) {
    router = routerInstance;
    route = routeInstance;
}

export function onTaskClosed(listener) {
    closeListeners.add(listener);
    return () => closeListeners.delete(listener);
}

function routeTaskId() {
    return route?.params?.taskId ? String(route.params.taskId) : "";
}

function taskRouteName(folderId) {
    return folderId ? "ProjectFolderSprintTask" : "ProjectSprintTask";
}

function stripTaskQuery(query) {
    const next = { ...(query || {}) };
    delete next[TASK_QUERY];
    delete next.detailTab;
    return next;
}

function normalize(payload) {
    return {
        companyId: String(payload.companyId || ""),
        projectId: String(payload.projectId || ""),
        sprintId: String(payload.sprintId || ""),
        folderId: payload.folderId ? String(payload.folderId) : "",
        taskId: String(payload.taskId || "")
    };
}

export const isExpanded = computed(() => Boolean(overlayState.current) && routeTaskId() === overlayState.current.taskId);

export function openTask(payload = {}) {
    const next = normalize(payload);
    if (!next.taskId) return;
    overlayState.minimized = overlayState.minimized.filter((item) => item.taskId !== next.taskId);
    overlayState.tab = payload.tab || "";
    if (overlayState.current?.taskId === next.taskId) {
        overlayState.current = { ...overlayState.current, ...next };
        overlayState.open = true;
        return;
    }
    overlayState.current = next;
    overlayState.open = true;
    if (router && route && routeTaskId() !== next.taskId && route.query?.[TASK_QUERY] !== next.taskId) {
        router.replace({ query: { ...stripTaskQuery(route.query), [TASK_QUERY]: next.taskId } }).catch(() => {});
    }
}

export function setTaskMeta(taskId, meta) {
    if (!taskId) return;
    overlayState.meta = { ...overlayState.meta, [taskId]: { ...(overlayState.meta[taskId] || {}), ...meta } };
    const docked = overlayState.minimized.find((item) => item.taskId === taskId);
    if (docked) Object.assign(docked, meta);
}

function leaveTaskRoute(current) {
    if (!router || !route) return;
    if (routeTaskId() === current.taskId && route.name) {
        const params = { ...route.params };
        delete params.taskId;
        router.replace({ name: String(route.name).replace("Task", ""), params, query: stripTaskQuery(route.query) }).catch(() => {});
    } else if (route.query?.[TASK_QUERY]) {
        router.replace({ query: stripTaskQuery(route.query) }).catch(() => {});
    }
}

export function closeTask({ keepRoute = false } = {}) {
    const current = overlayState.current;
    overlayState.open = false;
    overlayState.current = null;
    overlayState.tab = "";
    if (!current) return;
    if (!keepRoute) leaveTaskRoute(current);
    closeListeners.forEach((listener) => {
        try { listener(current); } catch (error) { console.error("ERROR in task overlay close listener: ", error); }
    });
}

export function expandTask() {
    const current = overlayState.current;
    if (!current || !router || !route) return;
    if (routeTaskId() === current.taskId) return;
    const params = {
        cid: current.companyId,
        id: current.projectId,
        sprintId: current.sprintId,
        taskId: current.taskId
    };
    if (current.folderId) params.folderId = current.folderId;
    router.push({ name: taskRouteName(current.folderId), params, query: stripTaskQuery(route.query) }).catch(() => {});
}

export function minimizeTask() {
    const current = overlayState.current;
    if (!current) return;
    const meta = overlayState.meta[current.taskId] || {};
    overlayState.minimized = [
        ...overlayState.minimized.filter((item) => item.taskId !== current.taskId),
        { ...current, taskKey: meta.taskKey || "", taskName: meta.taskName || "" }
    ];
    closeTask();
}

export function restoreTask(taskId) {
    const docked = overlayState.minimized.find((item) => item.taskId === taskId);
    if (docked) openTask(docked);
}

export function dismissMinimized(taskId) {
    overlayState.minimized = overlayState.minimized.filter((item) => item.taskId !== taskId);
}

export function isSameProjectPage(projectId, sprintId) {
    if (!route) return false;
    const name = String(route.name || "");
    if (!name.startsWith("Project") || name === "Projects") return false;
    if (String(route.params?.id || "") !== String(projectId || "")) return false;
    if (sprintId && route.params?.sprintId && String(route.params.sprintId) !== String(sprintId)) return false;
    return true;
}

export const TASK_QUERY_KEY = TASK_QUERY;

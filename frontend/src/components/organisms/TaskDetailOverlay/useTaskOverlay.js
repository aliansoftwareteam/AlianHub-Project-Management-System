import { reactive, computed, onBeforeUnmount, onMounted, unref } from "vue";
import { neighbours, readSequence } from "./taskNavigation";

const TASK_QUERY = "task";

export const overlayState = reactive({
    open: false,
    current: null,
    tab: "",
    meta: {},
    minimized: [],
    hostMounted: 0,
    nav: null
});

let router = null;
let route = null;
let sequenceRoot = null;
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

export function openTask(payload = {}, { history = "replace" } = {}) {
    const next = normalize(payload);
    if (!next.taskId) return;
    overlayState.minimized = overlayState.minimized.filter((item) => item.taskId !== next.taskId);
    overlayState.tab = payload.tab || "";
    if (overlayState.current?.taskId === next.taskId) {
        overlayState.current = { ...overlayState.current, ...next };
        overlayState.open = true;
        refreshNavigation();
        return;
    }
    overlayState.current = next;
    overlayState.open = true;
    refreshNavigation();
    if (router && route && routeTaskId() !== next.taskId && route.query?.[TASK_QUERY] !== next.taskId) {
        const to = { query: { ...stripTaskQuery(route.query), [TASK_QUERY]: next.taskId } };
        (history === "push" ? router.push(to) : router.replace(to)).catch(() => {});
    }
}

export function refreshNavigation() {
    const current = overlayState.current;
    const root = sequenceRoot ? sequenceRoot() : null;
    overlayState.nav = current && root ? neighbours(readSequence(root), current.taskId) : null;
}

/** The list, board or table on screen hands the overlay its root; the last one mounted wins. */
export function registerTaskSequence(getRoot) {
    sequenceRoot = getRoot;
    refreshNavigation();
    return () => {
        if (sequenceRoot !== getRoot) return;
        sequenceRoot = null;
        refreshNavigation();
    };
}

export function useTaskSequenceSource(rootRef) {
    let unregister = null;
    let observer = null;
    let frame = 0;
    const schedule = () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            refreshNavigation();
        });
    };
    onMounted(() => {
        unregister = registerTaskSequence(() => unref(rootRef));
        const root = unref(rootRef);
        if (root && typeof MutationObserver !== "undefined") {
            observer = new MutationObserver(schedule);
            observer.observe(root, { childList: true, subtree: true });
        }
    });
    onBeforeUnmount(() => {
        observer?.disconnect();
        if (frame) cancelAnimationFrame(frame);
        unregister?.();
    });
}

export function stepTask(direction) {
    refreshNavigation();
    const current = overlayState.current;
    const nav = overlayState.nav;
    const target = nav && (direction > 0 ? nav.next : nav.prev);
    if (!current || !target) return false;
    const payload = {
        companyId: current.companyId,
        projectId: target.projectId || current.projectId,
        sprintId: target.sprintId || current.sprintId,
        folderId: target.folderId,
        taskId: target.taskId
    };
    if (router && route && routeTaskId() === current.taskId) {
        const params = { cid: payload.companyId, id: payload.projectId, sprintId: payload.sprintId, taskId: payload.taskId };
        if (payload.folderId) params.folderId = payload.folderId;
        overlayState.current = normalize(payload);
        refreshNavigation();
        router.push({ name: taskRouteName(payload.folderId), params, query: stripTaskQuery(route.query) }).catch(() => {});
        return true;
    }
    openTask(payload, { history: "push" });
    return true;
}

/** Back and forward land on a task the view already lists; open it without a fetch. */
export function restoreFromSequence(taskId, companyId) {
    const root = sequenceRoot ? sequenceRoot() : null;
    const item = readSequence(root).find((entry) => entry.taskId === String(taskId));
    if (!item) return false;
    openTask({ ...item, companyId: overlayState.current?.companyId || companyId });
    return true;
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
    overlayState.nav = null;
    if (!current) return;
    if (!keepRoute) leaveTaskRoute(current);
    closeListeners.forEach((listener) => {
        try { listener(current); } catch (error) { console.error("ERROR in task overlay close listener: ", error); }
    });
}

/* The side panel belongs to the page it was opened on. The route has already moved,
 * so it is left alone; a task the new page names in its URL stays open. */
export function closeOnPageChange() {
    const current = overlayState.current;
    if (!overlayState.open || !current) return;
    if (routeTaskId() === current.taskId || String(route?.query?.[TASK_QUERY] || "") === current.taskId) return;
    closeTask({ keepRoute: true });
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

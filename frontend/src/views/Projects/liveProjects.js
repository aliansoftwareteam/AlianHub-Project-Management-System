import { onBeforeUnmount, unref, watch } from "vue";
import { useStore } from "vuex";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

/* A project was made, saved or trashed, here or by someone else. The signal carries its id alone, and is sent
 * only to people who may open it. What it holds is read from the project route, which answers this person only,
 * and goes into the store the sidebar, Home and the project page read. Changes that arrive close together, or
 * while the page is out of sight, cost one read a project, and a project that keeps changing is read every few
 * seconds at most: every open browser that may open it reads on the same signal. */

export const PROJECT_CHANGED_EVENT = "projectChanged";
export const GATHER_MS = 400;
export const GATHER_MAX_MS = 2000;
export const READ_GAP_MS = 3000;
const REMOVED = "removed";
const TRASHED = 1;
const NOT_OPEN_TO_THIS_PERSON = [403, 404];

const hidden = () => typeof document !== "undefined" && document.hidden === true;

// The socket and the company are passed in: the shell that provides them cannot inject them.
export function useLiveProjects(socket, companyId, openProjectId = () => "") {
    const store = useStore();

    let bound = null;
    let waiting = new Map();
    let firstAt = 0;
    let lastReadAt = 0;
    let timer = null;

    const company = () => String(unref(companyId) || "");
    const held = (id) => (store.getters["projectData/allProjects"]?.data || []).find((project) => String(project._id) === id);

    const drop = (id) => {
        const project = held(id);
        if (project) store.commit("projectData/mutateProjects", [{ op: "removed", data: { _id: project._id } }]);
    };

    const keep = (project) => {
        if (held(String(project._id))) store.commit("projectData/replaceProject", project);
        else store.commit("projectData/mutateProjects", [{ snap: null, privateSnap: false, op: "added", data: { ...project, id: project._id, isExpanded: false } }]);
    };

    async function follow(id, kind) {
        if (kind === REMOVED) {
            drop(id);
            return;
        }
        const askedIn = company();
        lastReadAt = Date.now();
        let project = null;
        try {
            const res = await apiRequest("get", `${env.PROJECT}/${id}`, undefined, undefined, { background: true });
            project = res?.data;
        } catch (e) {
            if (askedIn === company() && NOT_OPEN_TO_THIS_PERSON.includes(e?.response?.status)) drop(id);
            return;
        }
        if (askedIn !== company()) return;
        if (!project?._id || project.deletedStatusKey === TRASHED) drop(id);
        else keep(project);
    }

    function read() {
        timer = null;
        const changes = [...waiting];
        waiting = new Map();
        changes.forEach(([id, kind]) => follow(id, kind));
    }

    function schedule() {
        clearTimeout(timer);
        timer = null;
        if (hidden()) return;
        const now = Date.now();
        const gathered = Math.min(now + GATHER_MS, firstAt + GATHER_MAX_MS);
        timer = setTimeout(read, Math.max(0, gathered - now, lastReadAt + READ_GAP_MS - now));
    }

    const onChanged = (change) => {
        if (!change?.projectId || String(change.companyId || "") !== company()) return;
        if (!waiting.size) firstAt = Date.now();
        waiting.set(String(change.projectId), change.kind);
        schedule();
    };

    const onVisibility = () => {
        if (!waiting.size) return;
        firstAt = Date.now();
        schedule();
    };

    function unbind() {
        bound?.off?.(PROJECT_CHANGED_EVENT, onChanged);
        bound = null;
    }

    /* The shell drops its socket while the tab is hidden and connects a new one when it is seen again, so what was
     * said in between never arrives: the open project is read again instead. */
    function catchUp() {
        const id = String(openProjectId() || "");
        if (!id || !held(id) || waiting.has(id)) return;
        if (!waiting.size) firstAt = Date.now();
        waiting.set(id, "changed");
        schedule();
    }

    let everBound = false;
    function bind() {
        const live = unref(socket);
        if (live === bound) return;
        unbind();
        if (!live?.on) return;
        bound = live;
        live.on(PROJECT_CHANGED_EVENT, onChanged);
        if (everBound) catchUp();
        everBound = true;
    }

    watch(() => unref(socket), bind, { immediate: true });
    watch(() => company(), () => { waiting = new Map(); clearTimeout(timer); timer = null; });
    document.addEventListener("visibilitychange", onVisibility);
    onBeforeUnmount(() => {
        unbind();
        clearTimeout(timer);
        document.removeEventListener("visibilitychange", onVisibility);
    });
}

/* For a card that shows part of a project through its own route. The stored project follows `projectChanged`;
 * `follow` runs when it comes to hold something else under `field` than the card shows. What the card saved
 * itself it already shows, so its own save costs no second read. */
export function useStoredProjectPart(projectId, field, shown, follow) {
    const store = useStore();
    const stored = () => {
        const id = String(projectId() || "");
        const project = (store?.getters["projectData/allProjects"]?.data || []).find((item) => String(item._id) === id);
        return project?.[field] || null;
    };
    watch(() => JSON.stringify(Object.keys(shown).map((key) => stored()?.[key])), () => {
        const part = stored();
        if (part && Object.keys(shown).some((key) => part[key] !== undefined && part[key] !== shown[key])) follow();
    });
}

/* The project page keeps its own copy of the open project, so a view added elsewhere, by a person or by an
 * agent's approved proposal, reaches its tabs only when that copy takes the stored project's views. */
export function useStoredProjectViews(projectData) {
    const store = useStore();
    const storedViews = () => {
        const id = String(projectData.value?._id || "");
        const project = id ? (store?.getters["projectData/allProjects"]?.data || []).find((item) => String(item._id) === id) : null;
        return Array.isArray(project?.ProjectRequiredComponent) ? project.ProjectRequiredComponent : null;
    };
    watch(() => JSON.stringify(storedViews()), () => {
        const views = storedViews();
        if (!views || JSON.stringify(views) === JSON.stringify(projectData.value?.ProjectRequiredComponent || null)) return;
        projectData.value = { ...projectData.value, ProjectRequiredComponent: JSON.parse(JSON.stringify(views)) };
    });
}

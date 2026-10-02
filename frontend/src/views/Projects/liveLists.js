import { onBeforeUnmount, unref, watch } from "vue";
import { useStore } from "vuex";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { treeCache } from "@/components/molecules/ProjectTree/projectTreeData";
import { GATHER_MS, GATHER_MAX_MS, READ_GAP_MS } from "./liveProjects";

/* A list or a folder was made, renamed, moved, archived or removed, here or by someone else. The signal carries
 * its id and its project's, and is sent only to people who may see it. What the project holds is read from the
 * project's list route, which answers this person only, and replaces the two copies people look at: the open
 * project's in the store (the tree, the List and Board headers, the list menu and its sprint settings) and the
 * sidebar tree's own for the other projects it has opened. A project neither shows is not read. Changes that
 * arrive close together, or while the page is out of sight, cost one read a project and collection. */

export const LIST_CHANGED_EVENT = "listChanged";
export const FOLDERS_CHANGED_EVENT = "foldersChanged";

const SPRINTS = "sprints";
const FOLDERS = "folders";
const NAMED_BY = { [SPRINTS]: "sprintId", [FOLDERS]: "folderId" };

const hidden = () => typeof document !== "undefined" && document.hidden === true;
const idOf = (row) => String(row?._id || "");
const folderOf = (list) => (list?.folderId ? String(list.folderId) : "");
const urlOf = (projectId, collection) => `/api/v1/${env.GET_SPRINT_OR_PROJECT}/${projectId}?collection=${collection}`;

// The socket and the company are passed in: the shell that provides them cannot inject them.
export function useLiveLists(socket, companyId) {
    const store = useStore();

    let bound = null;
    let waiting = new Map();
    let firstAt = 0;
    let lastReadAt = 0;
    let timer = null;

    const company = () => String(unref(companyId) || "");
    const stored = (collection, projectId) => {
        const held = store.state.projectData?.[collection] || {};
        return Object.prototype.hasOwnProperty.call(held, projectId) ? held[projectId] : null;
    };
    const shown = (projectId) => Boolean(stored(SPRINTS, projectId) || stored(FOLDERS, projectId) || treeCache[projectId]);

    function keepLists(projectId, rows) {
        const held = stored(SPRINTS, projectId);
        if (held) {
            const folders = stored(FOLDERS, projectId) || [];
            const lists = rows.map((list) => ({ ...list, id: list._id }));
            lists.forEach((list) => {
                const before = held.find((item) => idOf(item) === idOf(list));
                if (!before || folderOf(before) === folderOf(list)) return;
                const folderName = folders.find((folder) => idOf(folder) === folderOf(list))?.name || "";
                store.commit("projectData/relocateSprint", { data: { ...list, folderName }, oldFolderId: folderOf(before) || null });
            });
            store.commit("projectData/replaceSprints", { projectId, sprints: lists });
        }
        if (treeCache[projectId]?.loaded) treeCache[projectId].sprints = rows;
    }

    function keepFolders(projectId, rows) {
        const folders = rows.map((folder) => ({ ...folder, parentFolderId: folder.parentFolderId || null }));
        if (stored(FOLDERS, projectId)) store.commit("projectData/replaceFolders", { projectId, folders });
        if (treeCache[projectId]?.loaded) treeCache[projectId].folders = folders;
    }

    async function follow(projectId, collection) {
        const askedIn = company();
        lastReadAt = Date.now();
        // The tree's first read may still be on its way, and would land on top of this one.
        await treeCache[projectId]?.loading;
        // Refused or failed, what is shown stays: a project this person lost is dropped by its own signal.
        const rows = await apiRequest("get", urlOf(projectId, collection), undefined, undefined, { background: true }).then((res) => res?.data, () => null);
        if (askedIn !== company() || !Array.isArray(rows)) return;
        if (collection === SPRINTS) keepLists(projectId, rows);
        else keepFolders(projectId, rows);
    }

    function read() {
        timer = null;
        const changes = [...waiting.values()];
        waiting = new Map();
        changes.filter(({ projectId }) => shown(projectId)).forEach(({ projectId, collection }) => follow(projectId, collection));
    }

    function schedule() {
        clearTimeout(timer);
        timer = null;
        if (hidden()) return;
        const now = Date.now();
        const gathered = Math.min(now + GATHER_MS, firstAt + GATHER_MAX_MS);
        timer = setTimeout(read, Math.max(0, gathered - now, lastReadAt + READ_GAP_MS - now));
    }

    const onChanged = (collection) => (change) => {
        const projectId = String(change?.projectId || "");
        if (!projectId || !change[NAMED_BY[collection]] || String(change.companyId || "") !== company() || !shown(projectId)) return;
        if (!waiting.size) firstAt = Date.now();
        waiting.set(`${projectId}:${collection}`, { projectId, collection });
        schedule();
    };
    const handlers = { [LIST_CHANGED_EVENT]: onChanged(SPRINTS), [FOLDERS_CHANGED_EVENT]: onChanged(FOLDERS) };

    const onVisibility = () => {
        if (!waiting.size) return;
        firstAt = Date.now();
        schedule();
    };

    function unbind() {
        Object.entries(handlers).forEach(([event, handler]) => bound?.off?.(event, handler));
        bound = null;
    }

    function bind() {
        const live = unref(socket);
        if (live === bound) return;
        unbind();
        if (!live?.on) return;
        bound = live;
        Object.entries(handlers).forEach(([event, handler]) => live.on(event, handler));
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

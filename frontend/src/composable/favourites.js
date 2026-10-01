import { computed, inject, reactive, watch } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { docRoute } from "@/components/molecules/Pages/docRoute";

export const favouritesState = reactive({ companyId: "", items: [], loaded: false });

const sync = { loading: null, version: 0, listening: false };

export const favouriteKey = (type, id) => `${type}:${id}`;

export function resetFavourites() {
    favouritesState.companyId = "";
    favouritesState.items = [];
    favouritesState.loaded = false;
    sync.loading = null;
    sync.version += 1;
}

export function isFavourite(type, id) {
    if (!id) return false;
    const key = favouriteKey(type, String(id));
    return favouritesState.items.some((item) => favouriteKey(item.type, item.id) === key);
}

const answered = (response) => (response?.data?.status && Array.isArray(response.data.data) ? response.data.data : null);

export function loadFavourites(companyId = favouritesState.companyId, { force = false } = {}) {
    if (!companyId) return Promise.resolve();
    if (companyId !== favouritesState.companyId) {
        resetFavourites();
        favouritesState.companyId = companyId;
    }
    if (sync.loading && !force) return sync.loading;
    if (favouritesState.loaded && !force) return Promise.resolve();
    const startedAt = sync.version;
    sync.loading = apiRequest("get", env.USER_FAVOURITES)
        .then((response) => {
            const items = answered(response);
            // A star clicked while this read was in flight is newer than what it returns.
            if (items && startedAt === sync.version && favouritesState.companyId === companyId) favouritesState.items = items;
            favouritesState.loaded = true;
        })
        .catch((error) => console.warn("favourites not loaded", error))
        .finally(() => { sync.loading = null; });
    return sync.loading;
}

function save(method, url, body, previous) {
    sync.version += 1;
    const version = sync.version;
    return apiRequest(method, url, body)
        .then((response) => {
            if (!response?.data?.status) throw new Error(response?.data?.statusText || "refused");
            const items = answered(response);
            if (items && version === sync.version) favouritesState.items = items;
        })
        .catch((error) => {
            if (version === sync.version) favouritesState.items = previous;
            console.warn("favourites not saved", error);
        });
}

export function toggleFavourite({ type, id, name = "", projectId, folderId, sprintId }) {
    if (!type || !id) return Promise.resolve();
    const previous = favouritesState.items;
    const on = !isFavourite(type, id);
    const key = favouriteKey(type, String(id));
    favouritesState.items = on
        ? [...previous, JSON.parse(JSON.stringify({ type, id: String(id), name, projectId, folderId, sprintId }))]
        : previous.filter((item) => favouriteKey(item.type, item.id) !== key);
    return save("put", env.USER_FAVOURITES, { type, id: String(id), favourite: on }, previous);
}

export function moveFavourite(from, to) {
    const list = [...favouritesState.items];
    if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return Promise.resolve();
    const previous = favouritesState.items;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    favouritesState.items = list;
    return save("put", `${env.USER_FAVOURITES}/order`, { keys: list.map((item) => favouriteKey(item.type, item.id)) }, previous);
}

export function favouriteRoute(item, cid) {
    const base = { cid };
    if (item.type === "project") return { name: "Project", params: { ...base, id: item.id } };
    if (item.type === "folder") return { name: "ProjectFolder", params: { ...base, id: item.projectId, folderId: item.id } };
    if (item.type === "sprint") {
        return item.folderId
            ? { name: "ProjectFolderSprint", params: { ...base, id: item.projectId, folderId: item.folderId, sprintId: item.id } }
            : { name: "ProjectSprint", params: { ...base, id: item.projectId, sprintId: item.id } };
    }
    if (item.type === "task") {
        if (!item.sprintId) return { name: "Project", params: { ...base, id: item.projectId } };
        return item.folderId
            ? { name: "ProjectFolderSprintTask", params: { ...base, id: item.projectId, folderId: item.folderId, sprintId: item.sprintId, taskId: item.id } }
            : { name: "ProjectSprintTask", params: { ...base, id: item.projectId, sprintId: item.sprintId, taskId: item.id } };
    }
    return docRoute(cid, item.id);
}

export function useFavourites() {
    const companyId = inject("$companyId", null);
    if (companyId) watch(() => companyId.value, (cid) => loadFavourites(cid ? String(cid) : ""), { immediate: true });
    // Another tab may have starred something; the list is per user, so no socket carries it here.
    if (!sync.listening && typeof document !== "undefined") {
        sync.listening = true;
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible" && favouritesState.loaded) loadFavourites(favouritesState.companyId, { force: true });
        });
    }
    return {
        items: computed(() => favouritesState.items),
        isFavourite,
        toggleFavourite,
        moveFavourite,
        loadFavourites,
        favouriteRoute
    };
}

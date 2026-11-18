import { reactive } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

/* Fetched straight from the API, not through projectData/setSprints: that store keeps one
   project's sprints at a time, and filling it for a second project would empty the open one. */
export const treeCache = reactive({});

export function resetProjectTreeCache() {
    Object.keys(treeCache).forEach((key) => { delete treeCache[key]; });
}

const rows = (response) => (Array.isArray(response?.data) ? response.data : []);
const url = (projectId, collection) => `/api/v1/${env.GET_SPRINT_OR_PROJECT}/${projectId}?collection=${collection}`;

export function loadProjectTree(projectId) {
    if (!projectId) return Promise.resolve();
    const known = treeCache[projectId];
    if (known) return known.loading || Promise.resolve();
    treeCache[projectId] = { sprints: [], folders: [], loaded: false, loading: null };
    const entry = treeCache[projectId];
    entry.loading = Promise.all([apiRequest("get", url(projectId, "sprints")), apiRequest("get", url(projectId, "folders"))])
        .then(([sprints, folders]) => {
            entry.sprints = rows(sprints);
            entry.folders = rows(folders);
            entry.loaded = true;
        })
        .catch((error) => {
            console.warn("project tree not loaded", error);
            delete treeCache[projectId];
        })
        .finally(() => { entry.loading = null; });
    return entry.loading;
}

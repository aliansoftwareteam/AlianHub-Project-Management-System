import { computed, reactive } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

export const SEARCH_FROM = 2;

/* The server names each source this person can open (`sourceNames` on the target). What they pick
   in the form before it is saved is named from where they picked it: a list in the project store,
   or a task the search answered with. Anything else is said to be out of their reach. */
const foundByStore = new WeakMap();
const foundIn = (store) => {
    if (!foundByStore.has(store)) foundByStore.set(store, reactive(new Map()));
    return foundByStore.get(store);
};

const listsIn = (project) => [
    ...Object.values(project.sprintsObj || {}).map((list) => ({ list, folder: "" })),
    ...Object.values(project.sprintsfolders || {}).flatMap((folder) => Object.values(folder?.sprintsObj || {}).map((list) => ({ list, folder: folder.name || "" })))
];

export function useGoalSources() {
    const store = useStore();
    const { t } = useI18n();
    const found = foundIn(store);

    const projects = computed(() => (store.getters["projectData/allProjects"]?.data || []).filter((project) => project && !project.deletedStatusKey));
    const projectNames = computed(() => new Map(projects.value.map((project) => [String(project._id), project.ProjectName || ""])));

    const lists = computed(() => [...new Map(projects.value.flatMap((project) => listsIn(project)
        .filter(({ list }) => list && !list.deletedStatusKey)
        .map(({ list, folder }) => {
            const id = String(list._id || list.id);
            return [id, { kind: "sprintIds", id, name: list.name || "", projectName: project.ProjectName || "", folderName: folder, offered: project.statusType !== "close" }];
        }))).values()]);
    const listsById = computed(() => new Map(lists.value.map((list) => [list.id, list])));

    const picked = (kind, id) => (kind === "sprintIds" ? listsById.value.get(id) : found.get(id));
    const sourceOf = (kind, id, names) => {
        const named = names?.[kind]?.[String(id)];
        if (named) return { kind, id: String(id), name: named.name || "", projectName: named.projectName || "", known: true };
        const known = picked(kind, String(id));
        if (known) return { ...known, known: true };
        return { kind, id: String(id), known: false, name: t(kind === "sprintIds" ? "Goals.source_list_unknown" : "Goals.source_task_unknown"), projectName: "" };
    };

    /* The search answers only with tasks this person can open. */
    async function searchTasks(query) {
        const response = await apiRequest("post", env.GLOBAL_SEARCH, { query });
        const rows = (response?.data?.status ? response.data.data?.tasks || [] : []).filter((row) => row?._id && projectNames.value.has(String(row.ProjectID)));
        rows.forEach((row) => found.set(String(row._id), { kind: "taskIds", id: String(row._id), name: row.TaskName || "", projectName: projectNames.value.get(String(row.ProjectID)) || "" }));
        return rows.map((row) => found.get(String(row._id)));
    }

    return { lists, sourceOf, searchTasks };
}

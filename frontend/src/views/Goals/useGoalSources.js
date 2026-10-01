import { computed, reactive } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

export const SEARCH_FROM = 2;

/* A goal's answer carries the ids of its lists and tasks, not their names. A name is shown only
   from what this person can already open: a list in the project store, or a task whose project
   (and, read back by id, whose list) is there. Anything else is said to be out of their reach. */
const tasksByStore = new WeakMap();
const tasksOf = (store) => {
    if (!tasksByStore.has(store)) tasksByStore.set(store, { seen: reactive(new Map()), asking: reactive(new Set()), asked: new Set() });
    return tasksByStore.get(store);
};

const listsIn = (project) => [
    ...Object.values(project.sprintsObj || {}).map((list) => ({ list, folder: "" })),
    ...Object.values(project.sprintsfolders || {}).flatMap((folder) => Object.values(folder?.sprintsObj || {}).map((list) => ({ list, folder: folder.name || "" })))
];

export function useGoalSources() {
    const store = useStore();
    const { t } = useI18n();
    const { seen, asking, asked } = tasksOf(store);

    const projects = computed(() => (store.getters["projectData/allProjects"]?.data || []).filter((project) => project && !project.deletedStatusKey));
    const projectNames = computed(() => new Map(projects.value.map((project) => [String(project._id), project.ProjectName || ""])));

    const lists = computed(() => [...new Map(projects.value.flatMap((project) => listsIn(project)
        .filter(({ list }) => list && !list.deletedStatusKey)
        .map(({ list, folder }) => {
            const id = String(list._id || list.id);
            return [id, { kind: "sprintIds", id, name: list.name || "", projectName: project.ProjectName || "", folderName: folder, offered: project.statusType !== "close" }];
        }))).values()]);
    const listsById = computed(() => new Map(lists.value.map((list) => [list.id, list])));

    const taskFrom = (row) => ({ kind: "taskIds", id: String(row._id), name: row.TaskName || "", projectName: projectNames.value.get(String(row.ProjectID)) || "" });
    const openable = (row, { listToo }) => projectNames.value.has(String(row?.ProjectID)) && (!listToo || listsById.value.has(String(row.sprintId)));
    const remember = (rows, rule) => rows.filter((row) => row?._id && openable(row, rule)).forEach((row) => seen.set(String(row._id), taskFrom(row)));

    const unnamed = (kind, id) => {
        if (kind === "sprintIds") return t("Goals.source_list_unknown");
        return t(asking.has(String(id)) ? "Goals.source_task" : "Goals.source_task_unknown");
    };
    const sourceOf = (kind, id) => {
        const known = kind === "sprintIds" ? listsById.value.get(String(id)) : seen.get(String(id));
        return known ? { ...known, known: true } : { kind, id: String(id), known: false, name: unnamed(kind, id), projectName: "" };
    };

    /* The search answers only with tasks this person can open, so its rows need no second check. */
    async function searchTasks(query) {
        const response = await apiRequest("post", env.GLOBAL_SEARCH, { query });
        const rows = response?.data?.status ? response.data.data?.tasks || [] : [];
        remember(rows, { listToo: false });
        return rows.map((row) => seen.get(String(row?._id))).filter(Boolean);
    }

    async function nameTasks(ids) {
        const unknown = [...new Set(ids.map(String))].filter((id) => !seen.has(id) && !asked.has(id));
        if (!unknown.length) return;
        unknown.forEach((id) => { asked.add(id); asking.add(id); });
        try {
            const response = await apiRequest("post", `${env.TASK}/find`, { findQuery: [{ $match: { _id: { objId: { $in: unknown } } } }] });
            remember(Array.isArray(response?.data) ? response.data : [], { listToo: true });
        } catch (error) {
            unknown.forEach((id) => asked.delete(id));
        }
        unknown.forEach((id) => asking.delete(id));
    }

    return { lists, sourceOf, searchTasks, nameTasks };
}

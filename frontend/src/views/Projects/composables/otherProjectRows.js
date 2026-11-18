import { computed, onBeforeUnmount, ref, unref, watch } from "vue";
import { useStore } from "vuex";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { taskInGroup } from "@/views/Projects/ListView/listFilter";

/* The tasks added to a list from other projects. The page loaded one project, so these rows are
 * not in its store: they come from the Everything read, which sends each row only to a person who
 * can open its home, with that project's card (statuses, apps, edit rights) beside it. */

export const MAX_PROJECTS = 500;
const PAGE_SIZE = 100;
const MAX_PAGES = 3;
const REFRESH_MS = 600;

const same = (a, b) => String(a ?? "") === String(b ?? "");

export function otherProjectIds(projects, projectId) {
    return (projects || [])
        .filter((project) => project?._id && !project.deletedStatusKey && !same(project._id, projectId))
        .map((project) => String(project._id))
        .slice(0, MAX_PROJECTS);
}

export function otherRowsRequest(listId, projectIds, cursor = null) {
    return { filter: { sprintIds: [String(listId)], projectIds }, limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) };
}

export function keepOtherRows(rows, cards, projectId) {
    return (rows || []).filter((row) => !same(row.ProjectID, projectId) && Boolean(cards?.[String(row.ProjectID)]));
}

/* Nothing this page loaded can judge an edit in the row's own project, so the row is drawn with
 * no edit right; the task panel loads that project and is where the task is changed. */
export const readOnlyCard = (card) => (card ? { ...card, edit: { status: false, priority: false } } : null);

/* A status belongs to its project, so a card sits under the column named like its own status
 * whatever the key is here. Under another grouping the value means the same in every project. */
export function columnFor(row, columns) {
    return (columns || []).find((column) => {
        if (column.customFieldId) return false;
        if (column.searchKey === "statusKey") return Boolean(column.name) && column.name === row.status?.text;
        return taskInGroup(row, column);
    }) || null;
}

export function placeOnBoard(rows, columns) {
    const placed = {};
    const unplaced = [];
    (rows || []).forEach((row) => {
        const column = columnFor(row, columns);
        if (!column) unplaced.push(row);
        else (placed[column.key] = placed[column.key] || []).push(row);
    });
    return { placed, unplaced };
}

export function useOtherProjectRows(project, listId) {
    const store = useStore();
    const rows = ref([]);
    const projects = ref({});
    const truncated = ref(false);
    let serial = 0;
    let timer = null;

    const projectId = computed(() => String(unref(project)?._id || ""));
    const list = computed(() => String(unref(listId) || ""));
    const others = computed(() => otherProjectIds(store.getters["projectData/onlyActiveProjects"]?.data, projectId.value));

    function show(found, cards, more) {
        rows.value = keepOtherRows(found, cards, projectId.value);
        projects.value = cards;
        truncated.value = more;
    }

    async function load() {
        const mine = ++serial;
        if (!projectId.value || !list.value || !others.value.length) {
            show([], {}, false);
            return;
        }
        try {
            const found = [];
            let cards = {};
            let cursor = null;
            for (let page = 0; page < MAX_PAGES; page += 1) {
                const data = (await apiRequest("post", env.V2_TASKS_EVERYTHING, otherRowsRequest(list.value, others.value, cursor)))?.data?.data;
                if (mine !== serial) return;
                found.push(...(data?.rows || []));
                cards = { ...cards, ...(data?.projects || {}) };
                cursor = data?.nextCursor || null;
                if (!cursor) break;
            }
            show(found, cards, Boolean(cursor));
        } catch (error) {
            if (mine === serial) show([], {}, false);
        }
    }

    function reloadSoon() {
        clearTimeout(timer);
        timer = setTimeout(load, REFRESH_MS);
    }

    watch([projectId, list, () => others.value.join()], load, { immediate: true });
    watch(() => store.getters["projectData/otherProjectChanges"] || 0, (now, before) => { if (now > before) reloadSoon(); });
    onBeforeUnmount(() => {
        clearTimeout(timer);
        serial += 1;
    });

    return { rows, projects, truncated };
}

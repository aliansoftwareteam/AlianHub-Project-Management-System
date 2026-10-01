import { computed, inject, ref, watch } from "vue";
import { useStore } from "vuex";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { useCustomComposable } from "@/composable";
import { loadedChildren } from "@/store/ProjectData/taskTree";
import { indexProgress, progressQuery, subtaskProgress, subtaskTotal } from "@/views/Projects/ListView/subtaskProgress";

const idOf = (task) => String(task?._id ?? "");
const own = (task) => (Array.isArray(task?.subtaskArray) ? task.subtaskArray : []);

/* The subtasks under the rows a view shows, three levels deep. They are read into the sprint's
 * task tree, the one the List fills, so every view shows the same rows and one socket event
 * updates them all. A view whose own rows live elsewhere (the Table) still finds them there:
 * the tree holds children for a parent it has not placed. */
export function useSubtaskTree({ project, sprintId, rows, showArchived, searched }) {
    const { getters, dispatch } = useStore();
    const { checkPermission } = useCustomComposable();
    const userId = inject("$userId", ref(""));
    const expandedIds = ref([]);
    const counts = ref({});

    const bucket = computed(() => getters["projectData/tasks"]?.[project.value?._id]?.[sprintId.value]);
    const isExpanded = (taskId) => expandedIds.value.includes(String(taskId));

    /* A row of the tree carries its children. A Table row does not, and a searched row carries only
     * the subtasks that matched: when it has none, the sprint's tree is asked. */
    const loaded = (task) => (own(task).length ? own(task) : loadedChildren(bucket.value, task?._id));

    const childrenOf = (task) => loaded(task).filter((sub) => (showArchived?.value ? sub.deletedStatusKey === 2 : !sub.deletedStatusKey));
    const hasChildren = (task) => Number(task?.subTasks) > 0 || loaded(task).length > 0;
    const counted = (task) => ({ subTasks: task?.subTasks, subtaskArray: loaded(task) });
    const progressFor = (task) => subtaskProgress(counted(task), counts.value[idOf(task)]);
    const totalFor = (task) => subtaskTotal(counted(task), counts.value[idOf(task)]);

    const withLoadedLevels = (list) => (list || []).flatMap((task) => (task ? [task, ...withLoadedLevels(loaded(task))] : []));
    const parents = computed(() => withLoadedLevels(rows.value).filter(hasChildren));
    const signature = computed(() => parents.value.map((task) => `${idOf(task)}:${Number(task.subTasks) || 0}:${loaded(task).length}`).sort().join(","));

    function loadCounts() {
        const ids = parents.value.map(idOf);
        if (!ids.length) return;
        apiRequest("post", `${env.TASK}/find`, { findQuery: progressQuery(ids) })
            .then((response) => { counts.value = { ...counts.value, ...indexProgress(response?.data) }; })
            .catch((error) => console.error("ERROR in subtask progress: ", error));
    }
    watch(signature, loadCounts, { immediate: true });

    /* Asked every time a row opens: the store answers at once for a parent whose children it has read. */
    function read(task, item) {
        const current = project.value || {};
        const permit = checkPermission("task.show_tasks", current.isGlobalPermission);
        if ((permit === null && current.isGlobalPermission === false) || !item) return Promise.resolve();
        return dispatch("projectData/getPaginatedTasks", {
            pid: current._id,
            sprintId: sprintId.value,
            item,
            fetchNew: true,
            firstPageOnly: true,
            parentId: idOf(task),
            indexName: item.indexName,
            userId: userId.value,
            showAllTasks: current.isGlobalPermission === false ? permit : true
        }).catch((error) => console.error("ERROR in read subtasks: ", error));
    }

    function expand(task, item) {
        const id = idOf(task);
        if (!id) return Promise.resolve();
        if (!isExpanded(id)) expandedIds.value = [...expandedIds.value, id];
        return searched?.value && own(task).length ? Promise.resolve() : read(task, item);
    }

    function toggle(task, item) {
        const id = idOf(task);
        if (!isExpanded(id)) return expand(task, item);
        expandedIds.value = expandedIds.value.filter((open) => open !== id);
        return Promise.resolve();
    }

    /* The subtasks a search matched are the reason their task is in the result, so they start open. */
    watch(() => (searched?.value ? withLoadedLevels(rows.value).filter((task) => own(task).length).map(idOf).join(",") : ""), (matched) => {
        if (matched) expandedIds.value = [...new Set([...expandedIds.value, ...matched.split(",")])];
    }, { immediate: true });

    return { isExpanded, toggle, expand, childrenOf, hasChildren, progressFor, totalFor };
}

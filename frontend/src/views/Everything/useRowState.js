import { computed } from "vue";
import { useStore } from "vuex";
import { isDoneStatus, priorityAppOn } from "@/views/Projects/ListView/listRowEdit";
import { projectColor } from "@/components/molecules/Home/homeFormat";

/* What a row, a card and a table row each show of a task. The project is handed in, never
 * injected: the tasks on this page belong to many projects, and the Priority app, the statuses
 * and the edit rights are each project's own. */
export function useRowState(task, project) {
    const getters = useStore()?.getters || {};

    const statuses = computed(() => project()?.taskStatusData || []);
    const done = computed(() => isDoneStatus({ type: task().statusType }));
    const canStatus = computed(() => project()?.edit?.status === true);
    const canPriority = computed(() => project()?.edit?.priority === true);
    const showPriority = computed(() => priorityAppOn(project(), getters["settings/selectedCompany"]?.planFeature));
    const taskType = computed(() => (project()?.taskTypeCounts || []).find((type) => type.key === task().TaskTypeKey) || null);
    const hasTypeIcon = computed(() => Boolean(taskType.value && (taskType.value.taskImage || taskType.value.iconValue)));
    const color = computed(() => projectColor(project()));
    const depth = computed(() => (Array.isArray(task().ancestors) ? task().ancestors.length : 0));

    return { statuses, done, canStatus, canPriority, showPriority, taskType, hasTypeIcon, color, depth };
}

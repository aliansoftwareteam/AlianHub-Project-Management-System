import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useCustomComposable } from '@/composable';

export const LIST_TAB = 'ProjectListView';

/* The Calendar and the Gantt have no place to type a task, so their empty state sends the person to the List, which has. */
export function useAddFirstTask(project) {
    const router = useRouter();
    const { checkPermission } = useCustomComposable();

    const canAddFirstTask = computed(() => checkPermission('task.task_create', project.value?.isGlobalPermission) === true
        && checkPermission('task.task_list', project.value?.isGlobalPermission) === true);

    const goToList = () => router.replace({ query: { tab: LIST_TAB } });

    return { canAddFirstTask, goToList };
}

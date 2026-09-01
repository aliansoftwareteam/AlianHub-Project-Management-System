import { ref } from 'vue';
import { markSearchClosed } from '@/utils/taskPanelGuard';

export const globalSearchOpen = ref(false);
export const lastSearchTasks = ref([]);

export function rememberSearchTasks(rows) {
    if (!Array.isArray(rows) || !rows.length) return;
    lastSearchTasks.value = rows;
}

export function openGlobalSearch() {
    globalSearchOpen.value = true;
}

export function closeGlobalSearch() {
    if (globalSearchOpen.value) markSearchClosed();
    globalSearchOpen.value = false;
}

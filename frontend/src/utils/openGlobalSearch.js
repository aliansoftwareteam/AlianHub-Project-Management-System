import { ref } from 'vue';
import { markSearchClosed } from '@/utils/taskPanelGuard';

export const globalSearchOpen = ref(false);

export function openGlobalSearch() {
    globalSearchOpen.value = true;
}

export function closeGlobalSearch() {
    if (globalSearchOpen.value) markSearchClosed();
    globalSearchOpen.value = false;
}

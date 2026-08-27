import { ref } from 'vue';

export const globalSearchOpen = ref(false);

export function openGlobalSearch() {
    globalSearchOpen.value = true;
}

import { ref } from "vue";

/* Bumped when every filter is cleared from outside the filter panel, so the panel drops
   the conditions it still shows as applied. */
export const clearFilterSignal = ref(0);

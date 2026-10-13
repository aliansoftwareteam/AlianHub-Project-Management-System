import { ref } from "vue";

/* Bumped when every filter is cleared from outside the filter panel, so the panel drops
   the conditions it still shows as applied. */
export const clearFilterSignal = ref(0);

/* Projects.vue provides the open view's filter rows under this key: the panel writes the rows
   it applies, and loads the rows a saved view brings. */
export const VIEW_FILTER_ROWS = 'viewFilterRows';

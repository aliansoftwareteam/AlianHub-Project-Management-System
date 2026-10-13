import { inject, ref } from "vue";

export const SUBTASK_EXPANSION = "listSubtaskExpansion";

/* Which parent rows are open, by task id. The List owns it, so a row keeps its state when a
 * change moves it to another group or its group is rebuilt. */
export const createSubtaskExpansion = () => ({ expandedIds: ref([]), autoExpandedIds: ref([]) });

export const useSubtaskExpansion = () => inject(SUBTASK_EXPANSION, null) || createSubtaskExpansion();

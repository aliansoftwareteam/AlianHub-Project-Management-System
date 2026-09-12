import { computed, inject, ref } from 'vue';

/* Which empty state a task view shows when it has nothing to list.
 *
 * `searchedTask` is the task list's own flag for "a search, an assignee pick, a saved filter
 * or the archive toggle is narrowing this list" (useProjectSearch). Without consulting it the
 * views blamed a filter for every empty list on a project that had ever held a task — so a
 * project whose tasks were all deleted, or whose view bar failed to render, sent the user
 * hunting for a filter that was never set. */
export function useTaskEmptyState(project) {
    const searchedTask = inject('searchedTask', ref(false));
    const kind = computed(() => {
        if (!project?.value?.lastTaskId) return 'no_tasks';
        return searchedTask?.value ? 'no_match' : 'no_visible_tasks';
    });

    return {
        emptyTitleKey: computed(() => `EmptyState.${kind.value}_title`),
        emptyMessageKey: computed(() => `EmptyState.${kind.value}_msg`),
    };
}

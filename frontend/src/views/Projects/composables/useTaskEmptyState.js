import { computed, inject, ref } from 'vue';

/* Which empty state a task view shows when it has nothing to list.
 *
 * Three signals, and none of them may be read as a proxy for another:
 *
 * - `showArchived` — the archive toggle. It has to be read FIRST, because useProjectSearch
 *   skips its early return whenever the toggle is on and sets `searchedTask` for the toggle
 *   alone. Reading `searchedTask` before the toggle is how an empty archive was reported as a
 *   filter problem and sent the user hunting for a filter that was never set.
 * - `project.lastTaskId` — the per-project counter that mints TaskKeys. It is only ever
 *   incremented, never decremented on delete, so falsy means no task was EVER created here
 *   and truthy means one was created once. It says nothing about what exists now.
 * - `searchedTask` — once the archive is ruled out this is exact: a query, an assignee pick
 *   or a saved filter is narrowing the list.
 *
 * With the archive and a narrowing both ruled out and a task known to have existed, nothing
 * here can say why the list is empty, so `no_visible_tasks` says exactly that rather than
 * guessing a cause. */
export function taskEmptyStateKind({ showArchived, lastTaskId, searched }) {
    if (showArchived) return 'no_archived';
    if (!lastTaskId) return 'no_tasks';
    return searched ? 'no_match' : 'no_visible_tasks';
}

export function useTaskEmptyState(project) {
    const searchedTask = inject('searchedTask', ref(false));
    const showArchived = inject('showArchived', ref(false));

    const kind = computed(() => taskEmptyStateKind({
        showArchived: !!showArchived?.value,
        lastTaskId: project?.value?.lastTaskId,
        searched: !!searchedTask?.value,
    }));

    return {
        emptyTitleKey: computed(() => `EmptyState.${kind.value}_title`),
        emptyMessageKey: computed(() => `EmptyState.${kind.value}_msg`),
    };
}

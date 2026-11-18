import { computed, inject, ref, toValue } from 'vue';

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
 * - `lists` — the lists in view. Each carries its own counters of live and archived tasks, so
 *   when every one of them counts none the view is empty because the lists are, a new list
 *   above all.
 *
 * With the archive and a narrowing both ruled out, a task known to have existed and a list that
 * counts tasks, nothing here can say why the view is empty, so `no_visible_tasks` says exactly
 * that rather than guessing a cause. */
const holdsNoTask = (list) => !Number(list?.tasks || 0) && !Number(list?.archiveTaskCount || 0);

export function taskEmptyStateKind({ showArchived, lastTaskId, searched, lists = [] }) {
    if (showArchived) return 'no_archived';
    if (!lastTaskId) return 'no_tasks';
    if (searched) return 'no_match';
    if (!lists.length || !lists.every(holdsNoTask)) return 'no_visible_tasks';
    return lists.length === 1 ? 'empty_list' : 'empty_lists';
}

const SENTENCES = { no_tasks: 'EmptyState.say_tasks', empty_list: 'EmptyState.say_list_tasks' };

/* A sentence is offered only where adding tasks fills the view. */
export const taskEmptySentenceKey = (kind) => SENTENCES[kind] || '';

export function useTaskEmptyState(project, lists = () => []) {
    const searchedTask = inject('searchedTask', ref(false));
    const showArchived = inject('showArchived', ref(false));
    const listsInView = computed(() => (toValue(lists) || []).filter((list) => list && !list.isFolder));

    const kind = computed(() => taskEmptyStateKind({
        showArchived: !!showArchived?.value,
        lastTaskId: project?.value?.lastTaskId,
        searched: !!searchedTask?.value,
        lists: listsInView.value,
    }));

    return {
        emptyTitleKey: computed(() => `EmptyState.${kind.value}_title`),
        emptyTitleParams: computed(() => ({ list: listsInView.value[0]?.name || '' })),
        emptyMessageKey: computed(() => `EmptyState.${kind.value}_msg`),
        emptySentenceKey: computed(() => taskEmptySentenceKey(kind.value)),
    };
}

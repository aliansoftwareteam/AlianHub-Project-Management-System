import { computed } from 'vue';
import { useStore } from 'vuex';

// Composable for multi-task selection across List / Kanban / Table views.
// Components only see this composable — they don't touch the Vuex module
// directly. Keeps the selection contract small and replaceable.
//
// Usage:
//   const { isSelected, toggle, toggleGroup, count, hasSelection, clear } = useTaskSelection();
//   <input type="checkbox" :checked="isSelected(task._id)" @click.stop="toggle(task._id, $event, visibleTaskIds)" />
//
// Shift+click range selection: pass the ordered list of currently visible
// task IDs as the third arg to `toggle`; the composable handles the range
// vs single behavior against the stored anchor.
export function useTaskSelection() {
    const store = useStore();

    // Direct state-backed refs. Going through Vuex method-style getters
    // (`(state) => (id) => state.x.includes(id)`) can lose reactivity for
    // callers that only invoke the inner function — Vue tracks the getter
    // access, not the array membership. Reading `state.selectedTaskIds`
    // directly inside a computed registers the right dependency.
    const selectedTaskIds = computed(() => store.state.taskSelection.selectedTaskIds);
    const count = computed(() => selectedTaskIds.value.length);
    const hasSelection = computed(() => selectedTaskIds.value.length > 0);
    const activeView = computed(() => store.state.taskSelection.activeView);

    const isSelected = (taskId) => {
        if (!taskId) return false;
        return selectedTaskIds.value.includes(String(taskId));
    };

    const toggle = (taskId, evt, visibleTaskIds) => {
        if (!taskId) return;
        const id = String(taskId);
        const wantsRange = !!(evt && evt.shiftKey);
        const anchor = store.state.taskSelection.lastAnchorId;

        if (wantsRange && anchor && Array.isArray(visibleTaskIds) && visibleTaskIds.length) {
            const ids = visibleTaskIds.map(String);
            const start = ids.indexOf(String(anchor));
            const end = ids.indexOf(id);
            if (start !== -1 && end !== -1) {
                const [from, to] = start < end ? [start, end] : [end, start];
                const range = ids.slice(from, to + 1);
                store.commit('taskSelection/selectMany', range);
                store.commit('taskSelection/setAnchor', id);
                return;
            }
        }

        store.commit('taskSelection/toggle', id);
        store.commit('taskSelection/setAnchor', id);
    };

    // Group header tri-state: select all visible ids when none/some are
    // selected, deselect them all when every visible id is already selected.
    const toggleGroup = (groupTaskIds) => {
        if (!Array.isArray(groupTaskIds) || !groupTaskIds.length) return;
        const ids = groupTaskIds.map(String);
        const selectedSet = new Set(selectedTaskIds.value);
        const allSelected = ids.every((id) => selectedSet.has(id));
        if (allSelected) {
            store.commit('taskSelection/deselectMany', ids);
        } else {
            store.commit('taskSelection/selectMany', ids);
        }
    };

    // Tri-state value for group header checkboxes: 'none' | 'some' | 'all'.
    const groupState = (groupTaskIds) => {
        if (!Array.isArray(groupTaskIds) || !groupTaskIds.length) return 'none';
        const selectedSet = new Set(selectedTaskIds.value);
        let selectedCount = 0;
        for (const id of groupTaskIds) {
            if (selectedSet.has(String(id))) selectedCount += 1;
        }
        if (selectedCount === 0) return 'none';
        if (selectedCount === groupTaskIds.length) return 'all';
        return 'some';
    };

    const clear = () => store.commit('taskSelection/clear');
    const setActiveView = (view) => store.commit('taskSelection/setActiveView', view);
    const setActiveProject = (projectId) => store.commit('taskSelection/setActiveProject', projectId);

    return {
        selectedTaskIds,
        count,
        hasSelection,
        activeView,
        isSelected,
        toggle,
        toggleGroup,
        groupState,
        clear,
        setActiveView,
        setActiveProject,
    };
}

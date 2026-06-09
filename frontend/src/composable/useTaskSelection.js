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

    // Locate a task in the projectData store and return it together with
    // its parent task (if it is a subtask). Used by the cascade logic to
    // walk parent ↔ subtask relationships without each caller having to
    // re-traverse the store.
    const findTaskWithParent = (taskId) => {
        const tasksState = store.state.projectData?.tasks || {};
        const targetId = String(taskId);
        for (const pid of Object.keys(tasksState)) {
            const project = tasksState[pid];
            const sprintIds = Array.isArray(project?.sprints) ? project.sprints : [];
            for (const sid of sprintIds) {
                const sprintData = project[sid];
                if (!sprintData?.tasks) continue;
                for (const t of sprintData.tasks) {
                    if (String(t?._id) === targetId) return { task: t, parent: null };
                    if (Array.isArray(t?.subtaskArray)) {
                        const sub = t.subtaskArray.find((s) => String(s?._id) === targetId);
                        if (sub) return { task: sub, parent: t };
                    }
                }
            }
        }
        return null;
    };

    // Toggle a task and keep the parent ↔ subtask selection consistent:
    //   • Parent toggled  → mirror new state onto every subtask.
    //   • Subtask toggled → if every sibling is now selected, select the
    //                       parent too; otherwise deselect the parent.
    // Falls back to a plain toggle for tasks that have no relations
    // (top-level tasks with no subtaskArray).
    const toggleAndCascade = (task, evt) => {
        if (!task?._id) return;
        const id = String(task._id);
        toggle(id, evt);
        const isNowSelected = selectedTaskIds.value.includes(id);

        // Down-cascade: parent → its loaded subtasks.
        if (task.isParentTask && Array.isArray(task.subtaskArray) && task.subtaskArray.length) {
            const subIds = task.subtaskArray.map((s) => String(s?._id)).filter(Boolean);
            if (subIds.length) {
                if (isNowSelected) {
                    store.commit('taskSelection/selectMany', subIds);
                } else {
                    store.commit('taskSelection/deselectMany', subIds);
                }
            }
            return;
        }

        // Up-cascade: subtask → its parent. After this subtask was toggled,
        // re-derive the parent's expected state from its siblings.
        if (task.isParentTask === false) {
            const parent = findTaskWithParent(id)?.parent;
            if (!parent?._id || !Array.isArray(parent.subtaskArray)) return;
            const siblingIds = parent.subtaskArray.map((s) => String(s?._id)).filter(Boolean);
            if (!siblingIds.length) return;
            const selectedSet = new Set(selectedTaskIds.value);
            const allSiblingsSelected = siblingIds.every((sid) => selectedSet.has(sid));
            const parentId = String(parent._id);
            const parentSelected = selectedSet.has(parentId);
            if (allSiblingsSelected && !parentSelected) {
                store.commit('taskSelection/selectMany', [parentId]);
            } else if (!allSiblingsSelected && parentSelected) {
                store.commit('taskSelection/deselectMany', [parentId]);
            }
        }
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
        toggleAndCascade,
        toggleGroup,
        groupState,
        clear,
        setActiveView,
        setActiveProject,
    };
}

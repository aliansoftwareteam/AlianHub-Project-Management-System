import { computed } from 'vue';
import { useStore } from 'vuex';
import { NAV_ATTR, readSequence } from '@/components/organisms/TaskDetailOverlay/taskNavigation';
import { locate } from '@/store/ProjectData/taskTree';

// Rows carry data-task-nav in screen order, so the ids read here already follow the
// view's filter, sort, grouping and collapsed groups.
export function visibleTaskIdsAround(el, scopeSelector) {
    const root = el && typeof el.closest === 'function' ? el.closest(scopeSelector) : null;
    return root ? readSequence(root).map((item) => item.taskId) : [];
}

function focusRowCheckbox(el, scopeSelector, taskId) {
    const root = el && typeof el.closest === 'function' ? el.closest(scopeSelector) : null;
    const row = root?.querySelector(`[${NAV_ATTR}="${String(taskId).replace(/"/g, '')}"]`);
    row?.querySelector('input[type="checkbox"]')?.focus();
}

export function useTaskSelection() {
    const store = useStore();

    // Read the state array directly: a method-style Vuex getter only tracks the getter
    // access, so callers lose reactivity on membership changes.
    const selectedTaskIds = computed(() => store.state.taskSelection.selectedTaskIds);
    const count = computed(() => selectedTaskIds.value.length);
    const hasSelection = computed(() => selectedTaskIds.value.length > 0);
    const activeView = computed(() => store.state.taskSelection.activeView);

    const isSelected = (taskId) => {
        if (!taskId) return false;
        return selectedTaskIds.value.includes(String(taskId));
    };

    const rangeTo = (id, visibleTaskIds) => {
        const anchor = store.state.taskSelection.lastAnchorId;
        if (!anchor || !Array.isArray(visibleTaskIds) || !visibleTaskIds.length) return null;
        const ids = visibleTaskIds.map(String);
        const start = ids.indexOf(String(anchor));
        const end = ids.indexOf(id);
        if (start === -1 || end === -1) return null;
        return start < end ? ids.slice(start, end + 1) : ids.slice(end, start + 1);
    };

    const toggle = (taskId, evt, visibleTaskIds) => {
        if (!taskId) return;
        const id = String(taskId);
        const range = evt?.shiftKey ? rangeTo(id, visibleTaskIds) : null;
        if (range) {
            store.commit('taskSelection/selectMany', range);
        } else {
            store.commit('taskSelection/toggle', id);
        }
        store.commit('taskSelection/setAnchor', id);
    };

    const findTaskWithParent = (taskId) => {
        const tasksState = store.state.projectData?.tasks || {};
        for (const pid of Object.keys(tasksState)) {
            const project = tasksState[pid];
            const sprintIds = Array.isArray(project?.sprints) ? project.sprints : [];
            for (const sid of sprintIds) {
                if (!project[sid]?.tasks) continue;
                const found = locate({ tasks: project[sid].tasks }, taskId);
                if (found) return { task: found.row, parent: found.parent };
            }
        }
        return null;
    };

    const subtaskIdsOf = (task) => (task?.isParentTask && Array.isArray(task.subtaskArray)
        ? task.subtaskArray.map((s) => String(s?._id || '')).filter(Boolean)
        : []);

    const selectRange = (range, id, { rowsAlone = false } = {}) => {
        store.commit('taskSelection/selectMany', range);
        const subIds = rowsAlone ? [] : range.flatMap((rid) => subtaskIdsOf(findTaskWithParent(rid)?.task));
        if (subIds.length) store.commit('taskSelection/selectMany', subIds);
        store.commit('taskSelection/setAnchor', id);
    };

    // The browser flips the box before the handler runs; a range only ever selects,
    // so a shift-click on an already checked box has to be put back.
    const syncCheckbox = (evt, id) => {
        const box = evt?.target;
        if (box && box.type === 'checkbox') box.checked = isSelected(id);
    };

    // Parent toggled: mirror onto its loaded subtasks. Subtask toggled: the parent is selected
    // exactly when every sibling is. A view that passes rowsAlone does neither: each row, on
    // any level, is selected by itself.
    const toggleAndCascade = (task, evt, visibleTaskIds, { rowsAlone = false } = {}) => {
        if (!task?._id) return;
        const id = String(task._id);
        const range = evt?.shiftKey ? rangeTo(id, visibleTaskIds) : null;
        if (range) {
            selectRange(range, id, { rowsAlone });
            syncCheckbox(evt, id);
            return;
        }
        toggle(id);
        syncCheckbox(evt, id);
        if (rowsAlone) return;
        const isNowSelected = selectedTaskIds.value.includes(id);

        const subIds = subtaskIdsOf(task);
        if (subIds.length) {
            store.commit(isNowSelected ? 'taskSelection/selectMany' : 'taskSelection/deselectMany', subIds);
            return;
        }

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

    // Shift+Space selects up to the focused row; Shift+Arrow extends by one row and
    // returns the id that should take focus next.
    const extendByKey = (task, evt, visibleTaskIds, options = {}) => {
        if (!task?._id || !evt?.shiftKey || evt.ctrlKey || evt.metaKey || evt.altKey) return null;
        const id = String(task._id);
        const ids = (visibleTaskIds || []).map(String);
        if (evt.key === ' ' || evt.key === 'Spacebar') {
            evt.preventDefault();
            const range = rangeTo(id, ids);
            if (range) selectRange(range, id, options);
            else toggleAndCascade(task, undefined, undefined, options);
            return id;
        }
        if (evt.key !== 'ArrowDown' && evt.key !== 'ArrowUp') return null;
        evt.preventDefault();
        const at = ids.indexOf(id);
        const nextId = at === -1 ? undefined : ids[at + (evt.key === 'ArrowDown' ? 1 : -1)];
        if (!nextId) return null;
        if (!rangeTo(id, ids)) store.commit('taskSelection/setAnchor', id);
        selectRange(rangeTo(nextId, ids) || [id, nextId], nextId, options);
        return nextId;
    };

    const selectFromEvent = (task, evt, scopeSelector, options = {}) => {
        const ids = visibleTaskIdsAround(evt?.target, scopeSelector);
        if (evt?.type !== 'keydown') {
            toggleAndCascade(task, evt, ids, options);
            return;
        }
        const focusId = extendByKey(task, evt, ids, options);
        if (focusId && focusId !== String(task._id)) focusRowCheckbox(evt.target, scopeSelector, focusId);
    };

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
        extendByKey,
        selectFromEvent,
        toggleGroup,
        groupState,
        clear,
        setActiveView,
        setActiveProject,
    };
}

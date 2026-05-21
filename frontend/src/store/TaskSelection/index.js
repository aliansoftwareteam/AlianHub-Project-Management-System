import * as actions from './actions.js';
import * as mutations from './mutations.js';

export default {
    namespaced: true,
    state: {
        selectedTaskIds: [],   // ordered array of string task ids
        lastAnchorId: null,    // anchor for shift+click range select
        activeView: null,      // 'list' | 'kanban' | 'table'
        activeProjectId: null, // project context — switching projects clears
    },
    getters: {
        selectedTaskIds: (state) => state.selectedTaskIds,
        count: (state) => state.selectedTaskIds.length,
        hasSelection: (state) => state.selectedTaskIds.length > 0,
        isSelected: (state) => (taskId) => taskId
            ? state.selectedTaskIds.includes(String(taskId))
            : false,
        lastAnchorId: (state) => state.lastAnchorId,
        activeView: (state) => state.activeView,
        activeProjectId: (state) => state.activeProjectId,
    },
    mutations,
    actions,
};

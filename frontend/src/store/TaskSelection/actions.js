// Thin action wrappers so call sites don't need to know mutation names.
// All real work happens in mutations.js. Actions exist for future async
// hooks (e.g. permission look-ups, analytics) without churning call sites.

export const toggle = ({ commit }, taskId) => {
    commit('toggle', taskId);
};

export const selectMany = ({ commit }, taskIds) => {
    commit('selectMany', taskIds);
};

export const deselectMany = ({ commit }, taskIds) => {
    commit('deselectMany', taskIds);
};

export const clear = ({ commit }) => {
    commit('clear');
};

export const setActiveView = ({ commit }, view) => {
    commit('setActiveView', view);
};

export const setActiveProject = ({ commit }, projectId) => {
    commit('setActiveProject', projectId);
};

export const setAnchor = ({ commit }, taskId) => {
    commit('setAnchor', taskId);
};

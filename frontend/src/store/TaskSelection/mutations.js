export const setActiveView = (state, view) => {
    // Clear selection when the active view changes (List <-> Kanban <-> Table)
    // or when entering a different project.
    if (state.activeView !== null && state.activeView !== view) {
        state.selectedTaskIds = [];
        state.lastAnchorId = null;
    }
    state.activeView = view;
};

export const setActiveProject = (state, projectId) => {
    if (state.activeProjectId !== null && state.activeProjectId !== projectId) {
        state.selectedTaskIds = [];
        state.lastAnchorId = null;
    }
    state.activeProjectId = projectId;
};

export const toggle = (state, taskId) => {
    if (!taskId) return;
    const id = String(taskId);
    const idx = state.selectedTaskIds.indexOf(id);
    if (idx === -1) {
        state.selectedTaskIds.push(id);
    } else {
        state.selectedTaskIds.splice(idx, 1);
    }
};

export const selectMany = (state, taskIds) => {
    if (!Array.isArray(taskIds) || !taskIds.length) return;
    const existing = new Set(state.selectedTaskIds);
    for (const t of taskIds) {
        const id = String(t);
        if (id && !existing.has(id)) {
            state.selectedTaskIds.push(id);
            existing.add(id);
        }
    }
};

export const deselectMany = (state, taskIds) => {
    if (!Array.isArray(taskIds) || !taskIds.length) return;
    const drop = new Set(taskIds.map(String));
    state.selectedTaskIds = state.selectedTaskIds.filter((id) => !drop.has(id));
};

export const clear = (state) => {
    state.selectedTaskIds = [];
    state.lastAnchorId = null;
};

export const setAnchor = (state, taskId) => {
    state.lastAnchorId = taskId ? String(taskId) : null;
};

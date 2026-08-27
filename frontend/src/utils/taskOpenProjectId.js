export function coerceId(value) {
    if (value == null) return '';
    if (typeof value === 'object') {
        if (typeof value.toHexString === 'function') return value.toHexString();
        return coerceId(value._id || value.id || '');
    }
    const raw = String(value).trim();
    if (!raw || raw === 'undefined' || raw === 'null' || raw === '[object Object]') return '';
    return raw;
}

export function firstId(...values) {
    for (const value of values) {
        const raw = coerceId(value);
        if (raw) return raw;
    }
    return '';
}

export function resolveTaskOpenIds(row) {
    if (!row || typeof row !== 'object') {
        return { projectId: '', sprintId: '', taskId: '' };
    }
    return {
        projectId: firstId(row.ProjectID, row.projectId, row.ProjectId),
        sprintId: firstId(row.sprintId, row.SprintId),
        taskId: firstId(row.taskId, row._id, row.id),
    };
}

export function resolveOpenProjectId({ queryProjectId, task, selectedTask, routeProjectId } = {}) {
    return firstId(
        queryProjectId,
        task && (task.ProjectID || task.projectId || task.ProjectId),
        selectedTask && (selectedTask.ProjectID || selectedTask.projectId || selectedTask.ProjectId),
        routeProjectId,
    );
}

export function shouldShowTaskSkeleton({ projectId, loaded, blocked } = {}) {
    return Boolean(projectId) && !loaded && !blocked;
}

export function shouldShowTaskChrome({ projectId, loaded, blocked } = {}) {
    if (blocked) return false;
    return Boolean(projectId) || Boolean(loaded);
}

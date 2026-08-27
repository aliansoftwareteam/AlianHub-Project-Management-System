export function firstId(...values) {
    for (const value of values) {
        const raw = value == null ? '' : String(value).trim();
        if (raw && raw !== 'undefined' && raw !== 'null') return raw;
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

'use strict';

function coerceId(value) {
    if (value == null) return '';
    if (typeof value === 'object') {
        if (typeof value.toHexString === 'function') return value.toHexString();
        return coerceId(value._id || value.id || '');
    }
    const raw = String(value).trim();
    if (!raw || raw === 'undefined' || raw === 'null' || raw === '[object Object]') return '';
    return raw;
}

function firstId(...values) {
    for (const value of values) {
        const raw = coerceId(value);
        if (raw) return raw;
    }
    return '';
}

function resolveOpenProjectId({ queryProjectId, task, selectedTask, routeProjectId } = {}) {
    return firstId(
        queryProjectId,
        task && (task.ProjectID || task.projectId || task.ProjectId),
        selectedTask && (selectedTask.ProjectID || selectedTask.projectId || selectedTask.ProjectId),
        routeProjectId,
    );
}

function shapeOpenTaskHit(row) {
    if (!row || typeof row !== 'object') return null;
    const taskId = firstId(row._id, row.id, row.taskId);
    if (!taskId) return null;
    return {
        _id: taskId,
        TaskName: row.TaskName || row.taskName || '',
        TaskKey: row.TaskKey || row.taskKey || '',
        status: row.status || null,
        statusType: row.statusType || '',
        ProjectID: firstId(row.ProjectID, row.projectId, row.ProjectId),
        sprintId: firstId(row.sprintId, row.SprintId),
        folderObjId: firstId(row.folderObjId, row.folderId),
    };
}

function shouldShowTaskSkeleton({ projectId, loaded, blocked } = {}) {
    return Boolean(projectId) && !loaded && !blocked;
}

function shouldShowTaskChrome({ projectId, loaded, blocked } = {}) {
    if (blocked) return false;
    return Boolean(projectId) || Boolean(loaded);
}

module.exports = {
    firstId,
    resolveOpenProjectId,
    shapeOpenTaskHit,
    shouldShowTaskSkeleton,
    shouldShowTaskChrome,
};

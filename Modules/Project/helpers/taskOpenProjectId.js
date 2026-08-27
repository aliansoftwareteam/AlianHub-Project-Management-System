'use strict';

function firstId(...values) {
    for (const value of values) {
        const raw = value == null ? '' : String(value).trim();
        if (raw && raw !== 'undefined' && raw !== 'null') return raw;
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

module.exports = {
    firstId,
    resolveOpenProjectId,
};

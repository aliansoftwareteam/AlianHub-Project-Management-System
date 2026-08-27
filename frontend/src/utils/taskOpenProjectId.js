export function coerceId(value) {
    if (value == null) return '';
    if (typeof value === 'object') {
        if (typeof value.toHexString === 'function') return value.toHexString();
        if (value.$oid) return coerceId(value.$oid);
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

export function sameId(a, b) {
    const left = firstId(a);
    const right = firstId(b);
    return Boolean(left) && left === right;
}

export function bindSprintsToProject(sprints, folders, projectId) {
    const sprintRows = Array.isArray(sprints) ? sprints : [];
    const folderRows = Array.isArray(folders) ? folders : [];
    const foldersObject = {};
    for (const folder of folderRows) {
        if (!sameId(folder.projectId, projectId)) continue;
        const folId = firstId(folder._id, folder.id, folder.folderId);
        if (!folId) continue;
        foldersObject[folId] = {
            folderId: folId,
            name: folder.name,
            sprintsObj: {},
            deletedStatusKey: folder.deletedStatusKey,
            legacyId: folder.legacyId || '',
            id: folId,
            _id: folId,
        };
    }
    const root = [];
    for (const sprint of sprintRows) {
        if (!sameId(sprint.projectId, projectId)) continue;
        const sid = firstId(sprint._id, sprint.id);
        if (!sid) continue;
        const row = { ...sprint, id: sid, _id: firstId(sprint._id) || sid };
        const folderId = firstId(sprint.folderId);
        if (folderId && foldersObject[folderId]) {
            row.folderName = foldersObject[folderId].name;
            foldersObject[folderId].sprintsObj[sid] = row;
        } else {
            root.push(row);
        }
    }
    const sprintsObj = {};
    root.forEach((row) => {
        sprintsObj[row.id] = row;
    });
    return { sprintsObj, sprintsfolders: foldersObject, sprintsArray: root };
}

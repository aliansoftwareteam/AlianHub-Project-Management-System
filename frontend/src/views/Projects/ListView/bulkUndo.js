const FIELDS = ["statusKey", "AssigneeUserId", "tagsArray", "sprintId", "deletedStatusKey"];

function* storedTasks(projectData = {}) {
    for (const bucket of [projectData.tasks, projectData.tableTasks]) {
        for (const project of Object.values(bucket || {})) {
            for (const sprint of Object.values(project || {})) {
                for (const task of (Array.isArray(sprint?.tasks) ? sprint.tasks : [])) {
                    yield task;
                    for (const sub of (Array.isArray(task?.subtaskArray) ? task.subtaskArray : [])) yield sub;
                }
            }
        }
    }
    for (const task of (Array.isArray(projectData.searchedTasks) ? projectData.searchedTasks : [])) yield task;
}

const copy = (value) => (Array.isArray(value) ? value.map(String) : value);

export function snapshotTasks(projectData, taskIds) {
    const wanted = new Set((taskIds || []).map(String));
    const found = {};
    for (const task of storedTasks(projectData)) {
        const id = String(task?._id || "");
        if (!wanted.has(id) || found[id]) continue;
        found[id] = Object.fromEntries(FIELDS.map((field) => [field, copy(task[field])]));
    }
    return Object.fromEntries([...wanted].filter((id) => found[id]).map((id) => [id, found[id]]));
}

function groupBy(ids, keyOf) {
    const groups = new Map();
    for (const id of ids) {
        const key = keyOf(id);
        if (key === undefined || key === null || key === "") continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(id);
    }
    return groups;
}

export function statusPayload(status) {
    return {
        status: { key: status.key, value: "", text: status.name, type: status.type, bgColor: status.bgColor, textColor: status.textColor },
        statusKey: status.key,
        statusType: status.type
    };
}

function projectSprints(project) {
    const inFolders = Object.values(project?.sprintsfolders || {}).flatMap((folder) => Object.values(folder?.sprintsObj || {}));
    return [...Object.values(project?.sprintsObj || {}), ...inFolders].filter(Boolean);
}

/* Each request is one existing bulk call. The API takes one new value per call, so tasks
 * that shared a previous value go back together and the rest get a call each. */
export function undoRequests({ action, payload = {}, before = {}, updatedIds = [], project }) {
    const known = updatedIds.map(String).filter((id) => before[id]);
    if (!known.length) return [];

    if (action === "bulkArchive" || action === "bulkTrash") {
        return [{ action: "bulkRestore", taskIds: known }];
    }

    if (action === "bulkUpdateStatus") {
        const target = payload.newStatus?.statusKey;
        const statuses = project?.taskStatusData || [];
        const groups = groupBy(known.filter((id) => before[id].statusKey !== target), (id) => before[id].statusKey);
        return [...groups].flatMap(([key, taskIds]) => {
            const status = statuses.find((s) => s.key === key);
            return status ? [{ action, taskIds, newStatus: statusPayload(status) }] : [];
        });
    }

    if (action === "bulkUpdateAssignee" && payload.type === "assigneeAdd") {
        const added = (payload.employeeId || []).map(String);
        const taskIds = known.filter((id) => added.some((uid) => !(before[id].AssigneeUserId || []).includes(uid)));
        return taskIds.length
            ? [{ action, type: "assigneRemove", employeeId: added, employeeName: payload.employeeName, taskIds }]
            : [];
    }

    if (action === "bulkUpdateTags" && payload.operation === "add") {
        const tagId = String(payload.tagId);
        const taskIds = known.filter((id) => !(before[id].tagsArray || []).includes(tagId));
        return taskIds.length ? [{ action, tagId: payload.tagId, operation: "remove", taskIds }] : [];
    }

    if (action === "bulkMove") {
        const target = String(payload.sprintObj?.id || "");
        const sprints = projectSprints(project);
        const groups = groupBy(known.filter((id) => String(before[id].sprintId || "") !== target), (id) => String(before[id].sprintId || ""));
        const projectData = { id: project?._id, ProjectCode: project?.ProjectCode, ProjectName: project?.ProjectName };
        return [...groups].flatMap(([sprintId, taskIds]) => {
            const sprintObj = sprints.find((sprint) => String(sprint.id) === sprintId);
            return sprintObj ? [{ action, taskIds, sprintObj, projectData }] : [];
        });
    }

    return [];
}

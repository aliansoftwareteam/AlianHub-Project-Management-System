const FIELDS = ["statusKey", "AssigneeUserId", "tagsArray", "sprintId", "deletedStatusKey", "Task_Priority", "DueDate"];

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

function groupBy(ids, keyOf, { keepEmpty = false } = {}) {
    const groups = new Map();
    for (const id of ids) {
        const key = keyOf(id);
        if (!keepEmpty && (key === undefined || key === null || key === "")) continue;
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

/* null marks a stored date that cannot be read: undo leaves that task alone rather than clear it. */
function dueKey(value) {
    if (!value) return "";
    const time = new Date(value.seconds ? value.seconds * 1000 : value).getTime();
    return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function projectSprints(project) {
    const inFolders = Object.values(project?.sprintsfolders || {}).flatMap((folder) => Object.values(folder?.sprintsObj || {}));
    return [...Object.values(project?.sprintsObj || {}), ...inFolders].filter(Boolean);
}

/* Each request is one existing bulk call. The API takes one new value per call, so tasks
 * that shared a previous value go back together and the rest get a call each. */
export function undoRequests({ action, payload = {}, before = {}, updatedIds = [], project, priorities = [] }) {
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

    if (action === "bulkUpdatePriority") {
        const target = payload.firebaseObj?.Task_Priority || "";
        const groups = groupBy(known.filter((id) => (before[id].Task_Priority || "") !== target), (id) => before[id].Task_Priority || "", { keepEmpty: true });
        return [...groups].map(([value, taskIds]) => {
            const name = priorities.find((priority) => priority.value === value)?.name || "N/A";
            return { action, taskIds, firebaseObj: { Task_Priority: value }, priorityObj: { priorityName: name, newPriorityName: name } };
        });
    }

    if (action === "bulkUpdateDueDate") {
        const target = dueKey(payload.DueDate);
        const changed = known.filter((id) => dueKey(before[id].DueDate) !== null && dueKey(before[id].DueDate) !== target);
        const groups = groupBy(changed, (id) => dueKey(before[id].DueDate), { keepEmpty: true });
        return [...groups].map(([date, taskIds]) => ({ action, taskIds, DueDate: date || null }));
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

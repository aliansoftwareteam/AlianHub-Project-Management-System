const idOf = (v) => (v === undefined || v === null ? '' : String(v));

const taskRow = (t) => ({
    taskId: String(t._id),
    key: t.TaskKey || '',
    title: t.TaskName || '',
    // Stored as { text, key, type }; agents get the readable name, not the object.
    status: (t.status && typeof t.status === 'object') ? (t.status.text || '') : (t.status || ''),
    statusType: t.statusType || (t.status && t.status.type) || '',
    priority: t.Task_Priority || '',
    projectId: String(t.ProjectID || ''),
    sprintId: String(t.sprintId || ''),
    dueDate: t.DueDate || null,
    estimateHours: Number(t.totalEstimatedTime || 0) / 3600 || 0,
});

/* What planning needs on top: who holds the task, where it sits in its tree and when it starts. */
const planRow = (t) => ({
    ...taskRow(t),
    assigneeIds: (Array.isArray(t.AssigneeUserId) ? t.AssigneeUserId : []).map(idOf).filter(Boolean),
    startDate: t.startDate || null,
    estimateMinutes: Number(t.totalEstimatedTime) || 0,
    subTasks: Number(t.subTasks) || 0,
    parentTaskId: idOf(t.ParentTaskId),
    ancestors: (Array.isArray(t.ancestors) ? t.ancestors : []).map(idOf),
    archived: [2, 3].includes(Number(t.deletedStatusKey)),
});

module.exports = { taskRow, planRow };

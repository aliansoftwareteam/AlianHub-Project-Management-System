const { isClosedStatusType } = require('./relationRules');

const RECURRENCE_FREQ = Object.freeze({
    WEEK: 'week',
    MONTH: 'month',
});

const RECURRENCE_FREQ_LIST = Object.freeze(Object.values(RECURRENCE_FREQ));

const normalizeFreq = (value) => {
    if (!value) return '';
    if (typeof value === 'object') return normalizeFreq(value.freq);
    const freq = String(value).toLowerCase();
    if (freq === 'weekly') return RECURRENCE_FREQ.WEEK;
    if (freq === 'monthly') return RECURRENCE_FREQ.MONTH;
    return RECURRENCE_FREQ_LIST.includes(freq) ? freq : '';
};

const shiftDate = (value, freq) => {
    const resolved = normalizeFreq(freq);
    if (!value || !resolved) return null;
    const next = new Date(value);
    if (!Number.isFinite(next.getTime())) return null;
    if (resolved === RECURRENCE_FREQ.WEEK) {
        next.setDate(next.getDate() + 7);
    } else {
        next.setMonth(next.getMonth() + 1);
    }
    return next;
};

const nextOccurrenceDates = ({ startDate, dueDate, freq }) => {
    const resolved = normalizeFreq(freq);
    if (!resolved) return null;
    const due = shiftDate(dueDate, resolved);
    if (!due) return null;
    return {
        freq: resolved,
        DueDate: due,
        startDate: startDate ? shiftDate(startDate, resolved) : null,
    };
};

const shouldSpawnNext = ({ prevStatusType, nextStatusType, recurrence }) => {
    if (isClosedStatusType(prevStatusType)) return false;
    if (!isClosedStatusType(nextStatusType)) return false;
    const freq = normalizeFreq(recurrence);
    if (!freq) return false;
    if (recurrence && recurrence.spawnedTaskId) return false;
    return true;
};

const pickOpenStatus = (project) => {
    const list = (project && Array.isArray(project.taskStatusData)) ? project.taskStatusData : [];
    const found = list.find((row) => row && row.type === 'default_active') || list.find((row) => row && row.type !== 'close') || {
        key: 1,
        name: 'To Do',
        type: 'default_active',
    };
    return {
        text: found.name || found.text || 'To Do',
        key: found.key || 1,
        type: found.type || 'default_active',
        value: found.value || '',
    };
};

const buildNextOccurrenceTask = (task, { dates, openStatus, spawnedFromId }) => {
    const status = openStatus || pickOpenStatus({});
    const durationMs = (task.startDate && task.DueDate)
        ? (new Date(task.DueDate).getTime() - new Date(task.startDate).getTime())
        : 0;
    let startDate = dates.startDate;
    if (!startDate && dates.DueDate && durationMs > 0) {
        startDate = new Date(dates.DueDate.getTime() - durationMs);
    }
    return {
        TaskName: task.TaskName,
        TaskKey: '-',
        AssigneeUserId: Array.isArray(task.AssigneeUserId) ? [...task.AssigneeUserId] : [],
        watchers: Array.isArray(task.watchers) ? [...task.watchers] : [],
        DueDate: dates.DueDate,
        dueDateDeadLine: dates.DueDate ? [{ date: dates.DueDate }] : [],
        TaskType: task.TaskType,
        TaskTypeKey: task.TaskTypeKey,
        ParentTaskId: '',
        ProjectID: task.ProjectID,
        CompanyId: task.CompanyId,
        status,
        isParentTask: true,
        Task_Leader: task.Task_Leader,
        sprintArray: task.sprintArray,
        Task_Priority: task.Task_Priority,
        deletedStatusKey: 0,
        sprintId: task.sprintId,
        statusType: status.type,
        statusKey: status.key,
        startDate: startDate || null,
        description: task.description || '',
        rawDescription: task.rawDescription || '',
        descriptionBlock: task.descriptionBlock || undefined,
        customField: task.customField && typeof task.customField === 'object' ? { ...task.customField } : {},
        folderObjId: task.folderObjId || undefined,
        recurrence: {
            freq: dates.freq,
            spawnedFromId: spawnedFromId ? String(spawnedFromId) : String(task._id || ''),
        },
        relations: [],
    };
};

module.exports = {
    RECURRENCE_FREQ,
    RECURRENCE_FREQ_LIST,
    normalizeFreq,
    shiftDate,
    nextOccurrenceDates,
    shouldSpawnNext,
    pickOpenStatus,
    buildNextOccurrenceTask,
};

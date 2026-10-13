// Export-job rules. Pure — no I/O — shared by controller, worker and tests.

const { neutraliseFormula } = require('../../../utils/csvSafe');
const { csvCell: csvEscape } = require('../../../utils/csv');

const FORMATS = Object.freeze(['csv', 'xlsx']);
const WORKSPACE = 'workspace';
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

const isObjectIdString = (id) => OBJECT_ID_PATTERN.test(String(id || ''));

/* Validate an export request. Returns { valid, reason }. */
const validateExportInput = ({ companyId, format, projectId, sprintId, userId }) => {
    if (!companyId) {
        return { valid: false, reason: 'companyId is required.' };
    }
    if (!userId) {
        return { valid: false, reason: 'userId is required.' };
    }
    if (!FORMATS.includes(format)) {
        return { valid: false, reason: `format must be one of: ${FORMATS.join(', ')}.` };
    }
    if (!isObjectIdString(projectId)) {
        return { valid: false, reason: 'A valid projectId is required.' };
    }
    if (sprintId !== undefined && sprintId !== null && sprintId !== '' && !isObjectIdString(sprintId)) {
        return { valid: false, reason: 'sprintId must be a valid id when provided.' };
    }
    return { valid: true, reason: '' };
};

/* Display filename: safe characters only, stamped. */
const buildFileName = ({ projectName, format, stamp }) => {
    const safe = String(projectName || 'tasks')
        .replace(/[^a-zA-Z0-9-_ ]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 40) || 'tasks';
    return `${safe}-tasks-${stamp}.${format}`;
};

/* Orders tasks as a tree, a parent and then its children, and gives each its level and its
 * direct parent's key. A task whose parent is not among them, or whose parents loop, is a
 * top-level row, so the file always describes a tree the CSV import can rebuild. */
const treeRows = (tasks) => {
    const rows = Array.isArray(tasks) ? tasks : [];
    const idOf = (task) => String(task._id);
    const byId = new Map(rows.filter((task) => task._id !== undefined && task._id !== null).map((task) => [idOf(task), task]));
    const parentIdOf = (task) => {
        const parentId = task.ParentTaskId ? String(task.ParentTaskId) : '';
        return parentId && parentId !== idOf(task) && byId.has(parentId) ? parentId : '';
    };
    const childrenOf = new Map();
    rows.forEach((task) => {
        const parentId = parentIdOf(task);
        if (parentId) childrenOf.set(parentId, [...(childrenOf.get(parentId) || []), task]);
    });

    const placed = new Set();
    const out = [];
    const place = (task, level, parentKey) => {
        if (placed.has(task)) return;
        placed.add(task);
        out.push({ task, level, parentKey });
        (childrenOf.get(idOf(task)) || []).forEach((child) => place(child, level + 1, task.TaskKey || ''));
    };
    rows.filter((task) => !parentIdOf(task)).forEach((task) => place(task, 1, ''));
    rows.forEach((task) => place(task, 1, ''));
    return out;
};

const taskToRow = (task, { level = 1, parentKey = '' } = {}) => {
    const row = {
        TaskKey: task.TaskKey || '',
        TaskName: task.TaskName || '',
        Parent: parentKey,
        Level: level,
        Status: (task.status && task.status.text) || '',
        StatusType: task.statusType || '',
        Priority: task.Task_Priority || '',
        Assignees: Array.isArray(task.AssigneeUserId) ? task.AssigneeUserId.join('; ') : '',
        DueDate: task.DueDate ? new Date(task.DueDate).toISOString().slice(0, 10) : '',
        EstimatedMinutes: task.totalEstimatedTime || '',
        CreatedAt: task.createdAt ? new Date(task.createdAt).toISOString() : '',
        UpdatedAt: task.updatedAt ? new Date(task.updatedAt).toISOString() : '',
    };
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, neutraliseFormula(value)]));
};

const taskRows = (tasks) => treeRows(tasks).map(({ task, ...place }) => taskToRow(task, place));

const workspaceTaskRow = (task, project, place) => ({
    Project: neutraliseFormula((project && project.ProjectName) || ''),
    ProjectKey: neutraliseFormula((project && project.ProjectCode) || ''),
    ...taskToRow(task, place),
});

const rowsToCsv = (rows) => {
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]);
    const lines = [headers.map(csvEscape).join(',')];
    rows.forEach((row) => {
        lines.push(headers.map((key) => csvEscape(row[key])).join(','));
    });
    return lines.join('\r\n');
};

module.exports = {
    FORMATS,
    WORKSPACE,
    isObjectIdString,
    validateExportInput,
    buildFileName,
    treeRows,
    taskToRow,
    taskRows,
    workspaceTaskRow,
    csvEscape,
    rowsToCsv,
};

// Export-job rules. Pure — no I/O — shared by controller, worker and tests.

const FORMATS = Object.freeze(['csv', 'xlsx']);
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

/* Flatten a task document into an export row (stable column order). */
const taskToRow = (task) => ({
    TaskKey: task.TaskKey || '',
    TaskName: task.TaskName || '',
    Status: (task.status && task.status.text) || '',
    StatusType: task.statusType || '',
    Priority: task.Task_Priority || '',
    Assignees: Array.isArray(task.AssigneeUserId) ? task.AssigneeUserId.join('; ') : '',
    DueDate: task.DueDate ? new Date(task.DueDate).toISOString().slice(0, 10) : '',
    EstimatedMinutes: task.totalEstimatedTime || '',
    CreatedAt: task.createdAt ? new Date(task.createdAt).toISOString() : '',
    UpdatedAt: task.updatedAt ? new Date(task.updatedAt).toISOString() : '',
});

/* RFC-4180-ish CSV escaping. */
const csvEscape = (value) => {
    const text = String(value === null || value === undefined ? '' : value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/* Rows (uniform objects) -> CSV string with header. */
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
    isObjectIdString,
    validateExportInput,
    buildFileName,
    taskToRow,
    csvEscape,
    rowsToCsv,
};

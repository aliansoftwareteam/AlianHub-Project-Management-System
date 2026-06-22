// Asana-import rules. Pure — no I/O — shared by the controller and the tests.
// Input: an Asana JSON export. Asana's "JSON export" of a project is an object
// shaped like:
//   { name, tasks: [{ name, notes, completed, due_on,
//                      assignee: { email, name },
//                      memberships: [{ section: { name } }],
//                      custom_fields: [{ name, display_value | text_value | enum_value:{name} }],
//                      subtasks: [...] }] }
// Sections become the source status names (mapped onto the project's existing
// statuses, with completed tasks falling back to "Done"); top-level tasks become
// tasks in the shape createMultipleTasks expects. Subtasks are NOT imported in
// this MVP (the create pipeline has no ParentTaskId-from-import support) — they
// are counted in `skipped`. Assignee emails are resolved to AlianHub users by the
// controller's enrichImportTasks (same email→userId path as Trello).
const { isObjectIdString, mapPriority, mapStatusName } = require('./jiraRules');

const MAX_TASKS = 2000;

// Pull the task list out of the various shapes Asana exports can take: a project
// object ({ data: { tasks } } or { tasks }), or a bare array of tasks.
const tasksOf = (asana) => {
    if (Array.isArray(asana)) return asana;
    if (asana && Array.isArray(asana.tasks)) return asana.tasks;
    if (asana && asana.data && Array.isArray(asana.data.tasks)) return asana.data.tasks;
    if (asana && asana.data && Array.isArray(asana.data)) return asana.data;
    return [];
};

// The section a task lives in becomes its status. Asana stores this on
// `memberships[].section.name`; fall back to a bare `section`/`section_name`.
const sectionNameOf = (task) => {
    const memberships = Array.isArray(task && task.memberships) ? task.memberships : [];
    for (const membership of memberships) {
        const name = membership && membership.section && membership.section.name;
        if (name !== undefined && name !== null && String(name).trim() !== '') return String(name).trim();
    }
    if (task && task.section && task.section.name) return String(task.section.name).trim();
    if (task && typeof task.section === 'string' && task.section.trim()) return String(task.section).trim();
    if (task && task.section_name) return String(task.section_name).trim();
    return '';
};

// Asana keeps priority in a custom field (commonly named "Priority"). The value
// can sit on display_value/text_value or an enum_value object. Returns '' if no
// priority field is present.
const priorityOf = (task) => {
    const fields = Array.isArray(task && task.custom_fields) ? task.custom_fields : [];
    for (const field of fields) {
        const fieldName = String((field && field.name) || '').trim().toLowerCase();
        if (fieldName !== 'priority') continue;
        if (field.display_value !== undefined && field.display_value !== null && String(field.display_value).trim() !== '') {
            return String(field.display_value).trim();
        }
        if (field.enum_value && field.enum_value.name) return String(field.enum_value.name).trim();
        if (field.text_value !== undefined && field.text_value !== null && String(field.text_value).trim() !== '') {
            return String(field.text_value).trim();
        }
    }
    return '';
};

const validateAsanaInput = ({ companyId, projectId, sprintId, asana, userId }) => {
    if (!companyId) return { valid: false, reason: 'companyId is required.' };
    if (!userId) return { valid: false, reason: 'userId is required.' };
    if (!isObjectIdString(projectId)) return { valid: false, reason: 'A valid projectId is required.' };
    if (!isObjectIdString(sprintId)) return { valid: false, reason: 'A valid sprintId is required.' };
    const tasks = tasksOf(asana);
    if (!asana || typeof asana !== 'object' || !tasks.length) {
        return { valid: false, reason: 'An Asana JSON export with a tasks array is required.' };
    }
    const named = tasks.filter((task) => task && String(task.name || '').trim());
    if (!named.length) return { valid: false, reason: 'No named tasks found in the Asana export.' };
    if (named.length > MAX_TASKS) return { valid: false, reason: `At most ${MAX_TASKS} tasks per import.` };
    return { valid: true, reason: '' };
};

/* Parse an Asana JSON export → { tasks, skipped, sectionNames }.
 * Nameless tasks are skipped; subtasks are flattened-out and skipped (counted).
 * Each task's section name is mapped onto an existing project status; completed
 * tasks with no section fall back to "Done" (which the shared status matcher
 * aliases to "Completed"). Assignee email is carried on memberEmails for the
 * controller to resolve. Pure — no I/O. */
const parseAsanaExport = ({ asana, statusNames, leaderId }) => {
    const sourceTasks = tasksOf(asana);
    const tasks = [];
    const sectionNames = new Set();
    let skipped = 0;

    sourceTasks.forEach((task) => {
        if (!task || !String(task.name || '').trim()) { skipped += 1; return; }

        // Subtasks are not importable in this MVP — count them and move on.
        const subtasks = Array.isArray(task.subtasks) ? task.subtasks.filter((sub) => sub && String(sub.name || '').trim()) : [];
        skipped += subtasks.length;

        const sectionName = sectionNameOf(task);
        if (sectionName) sectionNames.add(sectionName);
        // Section drives the status; completed tasks with no section land on "Done".
        const statusSource = sectionName || (task.completed ? 'Done' : '');
        const due = task.due_on ? new Date(task.due_on) : (task.due_at ? new Date(task.due_at) : null);
        const assigneeEmail = task.assignee && task.assignee.email ? String(task.assignee.email).trim() : '';
        const priorityRaw = priorityOf(task);

        tasks.push({
            TaskName: String(task.name).trim().slice(0, 500),
            status: mapStatusName(statusSource, statusNames),
            Task_Priority: priorityRaw ? mapPriority(priorityRaw) : 'Normal',
            TaskType: 'task',
            TaskTypeKey: 1,
            Task_Leader: leaderId,
            AssigneeUserId: [],
            DueDate: due && !Number.isNaN(due.getTime()) ? due.toISOString() : null,
            rawDescription: String(task.notes || '').slice(0, 10000),
            ParentTaskId: '',
            // Resolved to an assignee by enrichImportTasks (same path as Trello).
            memberEmails: assigneeEmail ? [assigneeEmail] : [],
        });
    });

    return { tasks, skipped, sectionNames: Array.from(sectionNames) };
};

module.exports = {
    MAX_TASKS,
    tasksOf,
    sectionNameOf,
    priorityOf,
    validateAsanaInput,
    parseAsanaExport,
};

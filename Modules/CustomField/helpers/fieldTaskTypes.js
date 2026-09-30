/* The web app reads this file through the @fieldTaskTypes alias, so the API, the task panel and every view agree on which tasks a field is for. */

const MAX_TASK_TYPES = 100;

const keyOf = (value) => {
    if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return null;
    const key = Number(value);
    return Number.isSafeInteger(key) && key > 0 ? key : null;
};

const fieldTaskTypes = (field) => [...new Set((Array.isArray(field && field.fieldTaskTypes) ? field.fieldTaskTypes : [])
    .map(keyOf)
    .filter((key) => key !== null))];

/* An empty list means every task type, which is how every field saved before task types behaves. */
const fieldAppliesToTask = (field, task) => {
    const types = fieldTaskTypes(field);
    return !types.length || types.includes(keyOf(task && task.TaskTypeKey));
};

const cleanTaskTypeList = (value) => {
    if (!Array.isArray(value) || value.length > MAX_TASK_TYPES) return null;
    const keys = value.map(keyOf);
    return keys.includes(null) ? null : [...new Set(keys)];
};

module.exports = { MAX_TASK_TYPES, fieldTaskTypes, fieldAppliesToTask, cleanTaskTypeList };

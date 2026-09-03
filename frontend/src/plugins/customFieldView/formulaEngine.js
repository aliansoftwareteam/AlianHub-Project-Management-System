// Display side of the `formula` and `rollup` custom field types.
//
// Formula EXPRESSIONS are never parsed here. The expression text is authored by
// admins and therefore untrusted, so it is evaluated only by the sandboxed
// parser in Modules/CustomField/helpers/formula.js and the result is stored on
// the task; this module reads that stored number back. Rollups are a plain
// aggregation over sibling tasks, so they are also summed locally to stay live
// while subtasks stream in over the socket.

import * as env from '@/config/env';
import { apiRequest } from '@/services';

export const ROLLUP_FUNCTIONS = ['sum', 'avg', 'count', 'min', 'max'];

function numericValue(raw) {
    if (raw === undefined || raw === null || raw === '') return null;
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/,/g, ''));
    return Number.isNaN(n) ? null : n;
}

function roundNice(n) {
    if (!Number.isFinite(n)) return '';
    return Math.round(n * 1e6) / 1e6;
}

function storedValue(fieldDef, task) {
    const entry = ((task && task.customField) || {})[String(fieldDef && fieldDef._id)];
    if (entry === undefined || entry === null) return '';
    const raw = typeof entry === 'object' ? entry.fieldValue : entry;
    return raw === undefined || raw === null ? '' : raw;
}

function subtasksOf(task, allTasks) {
    const id = String(task && task._id);
    if (!id) return [];
    return (Array.isArray(allTasks) ? allTasks : []).filter(
        (t) => t && String(t.ParentTaskId) === id && [0, 2, undefined, null].includes(t.deletedStatusKey)
    );
}

function computeRollup(fieldDef, task, allTasks) {
    const srcId = fieldDef && fieldDef.rollupSourceFieldId;
    const fn = (fieldDef && fieldDef.rollupFunction) || 'sum';
    const kids = subtasksOf(task, allTasks);
    if (!kids.length) return storedValue(fieldDef, task);
    if (fn === 'count') return kids.length;
    if (!srcId) return '';
    const values = [];
    kids.forEach((k) => {
        const entry = (k.customField || {})[srcId];
        const n = numericValue(entry && typeof entry === 'object' ? entry.fieldValue : entry);
        if (n !== null) values.push(n);
    });
    if (!values.length) return fn === 'sum' ? 0 : '';
    if (fn === 'sum') return roundNice(values.reduce((a, b) => a + b, 0));
    if (fn === 'avg') return roundNice(values.reduce((a, b) => a + b, 0) / values.length);
    if (fn === 'min') return roundNice(Math.min(...values));
    if (fn === 'max') return roundNice(Math.max(...values));
    return '';
}

// Display value for one computed field. Returns '' when there is nothing to show.
export function computeCustomFieldValue(fieldDef, task, allTasks) {
    if (!fieldDef) return '';
    if (fieldDef.fieldType === 'formula') return storedValue(fieldDef, task);
    if (fieldDef.fieldType === 'rollup') return computeRollup(fieldDef, task, allTasks);
    return '';
}

// Asks the server to re-evaluate every formula/rollup field on these tasks and
// store the result. Call it after a custom-field value changes.
export function recomputeCustomFields({ taskIds, projectId, scope }) {
    const ids = (Array.isArray(taskIds) ? taskIds : [taskIds]).filter(Boolean).map(String);
    if (!ids.length) return Promise.resolve(null);
    return apiRequest('post', env.CUSTOM_FIELD_COMPUTE, { taskIds: ids, projectId: projectId || '', scope: scope || 'subtask' })
        .then((response) => response?.data?.data || null)
        .catch(() => null);
}

// Display side of the `formula` and `rollup` custom field types.
//
// Formula EXPRESSIONS are never parsed here. The expression text is authored by
// admins and therefore untrusted, so it is evaluated only by the sandboxed
// parser in Modules/CustomField/helpers/formula.js and the result is stored on
// the task; this module reads that stored number back. A rollup is a plain
// aggregation over every subtask under the task, on every level, so it is also
// worked out here to stay live while subtasks stream in over the socket. It
// follows Modules/CustomField/helpers/computeFields.js, so both give one number.

import * as env from '@/config/env';
import { apiRequest } from '@/services';
import { fieldAppliesToTask } from '@fieldTaskTypes';

export const ROLLUP_FUNCTIONS = ['sum', 'avg', 'count', 'min', 'max'];

function numericValue(raw) {
    if (raw === undefined || raw === null || raw === '') return null;
    const n = Number(typeof raw === 'string' ? raw.replace(/,/g, '').trim() : raw);
    return Number.isFinite(n) ? n : null;
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

const DELETED = 1;
const idOf = (row) => String(row?._id ?? '');
const fieldValueOf = (row, fieldId) => {
    const entry = (row?.customField || {})[String(fieldId)];
    return entry && typeof entry === 'object' ? entry.fieldValue : entry;
};

/* The loaded rows by the task they sit under. Callers hand over a flat list, the store's tree
 * (each row's children in its subtaskArray), or both; a row is indexed once. */
function rowsByParent(task, allTasks) {
    const byParent = new Map();
    const indexed = new Set();
    const add = (row, holderId) => {
        if (!row || !row._id) return;
        const parentId = holderId || (row.ParentTaskId ? String(row.ParentTaskId) : '');
        if (parentId && !indexed.has(idOf(row))) {
            indexed.add(idOf(row));
            byParent.set(parentId, [...(byParent.get(parentId) || []), row]);
        }
        (Array.isArray(row.subtaskArray) ? row.subtaskArray : []).forEach((child) => add(child, idOf(row)));
    };
    add(task, '');
    (Array.isArray(allTasks) ? allTasks : []).forEach((row) => add(row, ''));
    return byParent;
}

/* Every row under the task that is not deleted, and whether all of them are loaded: a row's
 * `subTasks` says how many sit directly under it. */
function descendantsOf(task, allTasks) {
    const byParent = rowsByParent(task, allTasks);
    const seen = new Set([idOf(task)]);
    const rows = [];
    let complete = true;
    let level = [task];
    while (level.length) {
        const next = [];
        level.forEach((holder) => {
            const below = (byParent.get(idOf(holder)) || []).filter((row) => row.deletedStatusKey !== DELETED && !seen.has(idOf(row)));
            if (below.length < Number(holder?.subTasks || 0)) complete = false;
            below.forEach((row) => {
                seen.add(idOf(row));
                rows.push(row);
                next.push(row);
            });
        });
        level = next;
    }
    return { rows, complete };
}

/* A caller without the list of fields hands over a rollup that carries its source field. */
export function withRollupSources(defs, allDefs = defs) {
    return (defs || []).map((def) => {
        if (def?.fieldType !== 'rollup' || !def.rollupSourceFieldId) return def;
        const rollupSource = (allDefs || []).find((candidate) => String(candidate?._id) === String(def.rollupSourceFieldId));
        return rollupSource ? { ...def, rollupSource } : def;
    });
}

/* While part of the tree is not loaded, the number the server stored is the whole one. */
function computeRollup(fieldDef, task, allTasks, defs) {
    const srcId = fieldDef && fieldDef.rollupSourceFieldId;
    const fn = ROLLUP_FUNCTIONS.includes(fieldDef && fieldDef.rollupFunction) ? fieldDef.rollupFunction : 'sum';
    const { rows, complete } = descendantsOf(task, allTasks);
    if (!rows.length || !complete) return storedValue(fieldDef, task);

    const source = srcId ? fieldDef.rollupSource || (Array.isArray(defs) ? defs : []).find((def) => String(def?._id) === String(srcId)) : null;
    const holders = source ? rows.filter((row) => fieldAppliesToTask(source, row)) : rows;
    const raw = srcId
        ? holders.map((row) => fieldValueOf(row, srcId)).filter((entry) => entry !== undefined && entry !== null && entry !== '')
        : rows;
    if (fn === 'count') return raw.length;
    const values = srcId ? raw.map(numericValue).filter((n) => n !== null) : [];
    if (!values.length) return fn === 'sum' ? 0 : '';
    if (fn === 'sum') return roundNice(values.reduce((a, b) => a + b, 0));
    if (fn === 'avg') return roundNice(values.reduce((a, b) => a + b, 0) / values.length);
    if (fn === 'min') return roundNice(Math.min(...values));
    return roundNice(Math.max(...values));
}

// Display value for one computed field. Returns '' when there is nothing to show.
export function computeCustomFieldValue(fieldDef, task, allTasks, defs) {
    if (!fieldDef) return '';
    if (fieldDef.fieldType === 'formula') return storedValue(fieldDef, task);
    if (fieldDef.fieldType === 'rollup') return computeRollup(fieldDef, task, allTasks, defs);
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

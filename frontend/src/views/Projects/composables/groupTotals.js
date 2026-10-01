import { computeCustomFieldValue } from '@/plugins/customFieldView/formulaEngine.js';
import { fieldAppliesToTask, fieldTaskTypes } from '@fieldTaskTypes';
import { taskPoints } from './taskPoints';

const FIELD_ID = /^[a-f0-9]{24}$/i;
const NUMBER_TYPES = ['number', 'money'];
const COMPUTED_TYPES = ['formula', 'rollup'];

const givesNumber = (field) => NUMBER_TYPES.includes(field?.fieldType)
    || (COMPUTED_TYPES.includes(field?.fieldType) && field.fieldValidation !== 'text');

/* The shown columns a group adds up, each with where the server finds its value (store/ProjectData/taskQueries.js). */
export function totalColumnsOf(columns) {
    return (columns || []).flatMap((column) => {
        if (column?.id === 'points') return [{ id: column.id, path: 'points', wrapped: false, taskTypes: [] }];
        const field = column?.field;
        if (!field || !givesNumber(field) || !FIELD_ID.test(String(field._id))) return [];
        return [{ id: column.id, path: `customField.${field._id}`, wrapped: true, taskTypes: fieldTaskTypes(field), field }];
    });
}

const numberOf = (raw) => {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const number = Number(raw);
    return Number.isFinite(number) ? number : null;
};

const round = (number) => Math.round(number * 1e6) / 1e6;

const storedValue = (task, field) => {
    const entry = (task?.customField || {})[String(field._id)];
    return entry && typeof entry === 'object' ? entry.fieldValue : entry;
};

const rowValue = (task, total, { allTasks, defs }) => {
    if (!total.field) return taskPoints(task);
    if (!fieldAppliesToTask(total.field, task)) return null;
    return numberOf(COMPUTED_TYPES.includes(total.field.fieldType)
        ? computeCustomFieldValue(total.field, task, allTasks, defs)
        : storedValue(task, total.field));
};

/* A group's rows are tasks, never subtasks, so this adds what the server's total adds. A blank counts as zero. */
export function loadedTotals(rows, totals, { allTasks = [], defs = [] } = {}) {
    return Object.fromEntries((totals || []).map((total) => [
        total.id,
        round((rows || []).reduce((sum, task) => sum + (rowValue(task, total, { allTasks, defs }) || 0), 0))
    ]));
}

export function totalText(total, value) {
    if (value === undefined || value === null) return '';
    const symbol = total?.field?.fieldType === 'money' ? total.field.fieldMoneySymbol || '' : '';
    return `${symbol}${round(Number(value) || 0)}`;
}

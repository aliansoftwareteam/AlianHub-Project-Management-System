import { computed, unref } from 'vue';
import { useStore } from 'vuex';
import moment from 'moment';
import { useCustomComposable } from '@/composable';
import { computeCustomFieldValue } from '@/plugins/customFieldView/formulaEngine.js';
import { fieldAppliesToTask, fieldTaskTypes } from '@fieldTaskTypes';
import { MODULE_FIELD_TYPES, typeModuleOf } from '@fieldTypes';

export { fieldAppliesToTask, fieldTaskTypes };

export const COMPUTED_TYPES = ['formula', 'rollup'];
export const FIELD_TYPES = ['text', 'textarea', 'number', 'money', 'date', 'dropdown', 'checkbox', 'email', 'phone', ...MODULE_FIELD_TYPES, ...COMPUTED_TYPES];

/* The same selection the task panel's custom field section makes (customFieldRender). */
export function projectFieldDefs(defs, projectId) {
    return (defs || []).filter((def) => def?.isDelete
        && (def.type || 'task') === 'task'
        && FIELD_TYPES.includes(def.fieldType)
        && (def.global || [].concat(def.projectId || []).map(String).includes(String(projectId))));
}

export const storedEntry = (task, def) => (task?.customField || {})[String(def?._id)] || null;

const rawValue = (task, def, allTasks) => {
    if (COMPUTED_TYPES.includes(def?.fieldType)) return computeCustomFieldValue(def, task, allTasks);
    const entry = storedEntry(task, def);
    if (entry === null || entry === undefined) return '';
    return typeof entry === 'object' ? entry.fieldValue : entry;
};

export const storedFieldValue = (task, def) => rawValue(task, def, []);

const isBlank = (value) => value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);

export function dropdownChoices(def, value) {
    const chosen = [].concat(isBlank(value) ? [] : value).map(String);
    return (def?.fieldOptions || []).filter((option) => option && chosen.includes(String(option.id)));
}

/* One display string per type, '' for nothing, so every view shows a value the same way. */
export function customFieldText(def, task, { allTasks = [], dateFormat = 'DD/MM/YYYY', userName } = {}) {
    const value = rawValue(task, def, allTasks);
    const type = typeModuleOf(def?.fieldType);
    if (type) return type.text(value, def, { userName });
    switch (def?.fieldType) {
        case 'checkbox':
            return value === true || value === 'true' ? '✓' : '';
        case 'dropdown':
            return dropdownChoices(def, value).map((option) => option.label || option.value || '').join(', ');
        case 'date': {
            if (isBlank(value)) return '';
            const date = moment(value?.seconds ? value.seconds * 1000 : value);
            return date.isValid() ? date.format(dateFormat) : '';
        }
        case 'money':
            return isBlank(value) ? '' : `${def.fieldMoneySymbol || ''}${value}`;
        case 'phone': {
            if (isBlank(value)) return '';
            const code = storedEntry(task, def)?.fieldCode;
            return [code, value].filter(Boolean).join(' ');
        }
        default:
            return isBlank(value) ? '' : String(value);
    }
}

export function shownFieldValues(columns, task, options = {}) {
    return (columns || [])
        .filter((column) => column?.field && fieldAppliesToTask(column.field, task))
        .map((column) => ({
            id: column.id,
            label: column.label || column.field.fieldTitle || '',
            text: customFieldText(column.field, task, options),
            choices: column.field.fieldType === 'dropdown' ? dropdownChoices(column.field, storedEntry(task, column.field)?.fieldValue) : [],
            field: column.field,
            value: rawValue(task, column.field, [])
        }))
        .filter((entry) => entry.text);
}

export const fieldIsChecked = (def, task) => {
    const value = rawValue(task, def, []);
    return value === true || value === 'true';
};

export const fieldEditValue = (def, task) => {
    const value = rawValue(task, def, []);
    if (def?.fieldType === 'dropdown') return dropdownChoices(def, value)[0]?.id ?? '';
    if (def?.fieldType === 'date') {
        if (isBlank(value)) return '';
        const date = moment(value?.seconds ? value.seconds * 1000 : value);
        return date.isValid() ? date.format('YYYY-MM-DD') : '';
    }
    return isBlank(value) ? '' : value;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUMBER = /^-?\d+(\.\d+)?$/;

/* The value the task panel's submitHandler would store for this input, or `{ invalid }`. */
export function customFieldPayload(def, input) {
    const type = def?.fieldType;
    if (COMPUTED_TYPES.includes(type)) return { invalid: true };
    const typeModule = typeModuleOf(type);
    if (typeModule) {
        const { value, error } = typeModule.parse(typeModule.fromInput ? typeModule.fromInput(input) : input, def);
        return error ? { invalid: true } : { fieldValue: value, _id: def._id };
    }
    if (type === 'checkbox') return { fieldValue: input === true, _id: def._id };
    if (type === 'dropdown') return { fieldValue: isBlank(input) ? [] : [input], _id: def._id };
    const text = typeof input === 'string' ? input.trim() : input;
    if (isBlank(text)) return { fieldValue: '', _id: def._id };
    if (type === 'date') {
        const date = moment(text, 'YYYY-MM-DD', true);
        return date.isValid() ? { fieldValue: date.toDate(), _id: def._id } : { invalid: true };
    }
    if (type === 'number' || type === 'money') {
        const clean = String(text).replace(/,/g, '');
        return NUMBER.test(clean) ? { fieldValue: clean, _id: def._id } : { invalid: true };
    }
    if (type === 'email') return EMAIL.test(text) ? { fieldValue: text, _id: def._id } : { invalid: true };
    if (type === 'phone') {
        const digits = String(text).replace(/^\+(\d+)\s|\s|\(|\)|-/g, '');
        if (!/^\d{4,15}$/.test(digits)) return { invalid: true };
        return { fieldValue: digits, _id: def._id };
    }
    return { fieldValue: String(text), _id: def._id };
}

const emptyValue = (def) => {
    const type = typeModuleOf(def?.fieldType);
    if (type) return Array.isArray(type.empty) ? [...type.empty] : type.empty;
    if (def?.fieldType === 'dropdown') return [];
    return def?.fieldType === 'checkbox' ? false : '';
};

export const emptyFieldDetail = (def) => ({ fieldValue: emptyValue(def), _id: def?._id });

/* Values ride on the tasks the view already loaded, so nothing is fetched per row. */
export function flatTasks(taskMaps, projectId) {
    const flat = [];
    const seen = new Set();
    const add = (task) => {
        if (!task?._id || seen.has(String(task._id))) return;
        seen.add(String(task._id));
        flat.push(task);
    };
    [].concat(taskMaps || []).forEach((taskMap) => {
        Object.values(taskMap?.[projectId] || {}).forEach((node) => {
            (Array.isArray(node?.tasks) ? node.tasks : []).forEach((task) => {
                add(task);
                (task.subtaskArray || []).forEach(add);
            });
        });
    });
    return flat;
}

export function useProjectCustomFields(projectRef, { archived } = {}) {
    const { getters } = useStore();
    const { checkApps, checkPermission } = useCustomComposable();
    const project = computed(() => unref(projectRef) || {});
    const permission = computed(() => checkPermission('task.task_custom_field', project.value?.isGlobalPermission));

    const enabled = computed(() => Boolean(project.value?._id)
        && checkApps('CustomFields')
        && Boolean(getters['settings/selectedCompany']?.planFeature?.customFields)
        && permission.value !== null && permission.value !== undefined);

    const defs = computed(() => (enabled.value ? projectFieldDefs(getters['settings/finalCustomFields'], project.value._id) : []));
    const canEdit = computed(() => enabled.value && permission.value === true && !unref(archived));
    const hasComputed = computed(() => defs.value.some((def) => COMPUTED_TYPES.includes(def.fieldType)));

    const allTasks = computed(() => (hasComputed.value
        ? flatTasks([getters['projectData/tasks'], getters['projectData/tableTasks']], project.value._id)
        : []));

    return { defs, canEdit, allTasks, hasComputed };
}

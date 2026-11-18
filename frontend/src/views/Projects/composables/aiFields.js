import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { flatTasks } from './projectCustomFields';
import { maxOf as ratingFieldMax, settings as ratingSettings, type as RATING_FIELD } from '@fieldTypes/rating';

/* Each output the builder offers: the field type that stores and renders it, and the output the server checks. */
const OUTPUTS = {
    textarea: { fieldType: 'textarea', output: 'text', templates: ['summary', 'progress_update', 'translation', 'action_items', 'custom'] },
    dropdown: { fieldType: 'dropdown', output: 'option', templates: ['category', 'custom'] },
    labels: { fieldType: 'dropdown', output: 'labels', templates: ['labels', 'custom'] },
    number: { fieldType: 'number', output: 'number', templates: ['custom'] },
    rating: { fieldType: 'number', output: 'rating', templates: ['custom'] },
    date: { fieldType: 'date', output: 'date', templates: ['custom'] }
};

export const AI_OUTPUTS = Object.keys(OUTPUTS);
export const AI_FIELD_TYPES = [...new Set([...AI_OUTPUTS.map((key) => OUTPUTS[key].fieldType), RATING_FIELD])];
export const AI_READ_PARTS = ['title', 'description', 'comments', 'subtasks'];
export const OPTION_OUTPUTS = ['dropdown', 'labels'];
export const DATE_RULES = ['', 'after_start', 'not_past'];
export const RATING_MAX = 5;
export const DECIMALS_MAX = 6;

const DEFAULT_READS = ['title', 'description'];
const OPTION_COLOR = '#34495E';
const NUMBER = /^-?\d+(\.\d+)?$/;

export const templatesFor = (output) => [...(OUTPUTS[output]?.templates || [])];

export const aiConfigOf = (def) => (def?.fieldAi?.enabled === true && AI_FIELD_TYPES.includes(def?.fieldType) ? def.fieldAi : null);

export const isAiField = (def) => Boolean(aiConfigOf(def));

/* A rating output is a rating field with its own maximum. One saved before that type existed is a number field from 1 to 5, and stays one. */
export const aiRatingMaxOf = (def) => (def?.fieldType === RATING_FIELD ? ratingFieldMax(def) : RATING_MAX);

export function aiOutputOf(def) {
    if (def?.fieldType === RATING_FIELD) return 'rating';
    const matching = AI_OUTPUTS.filter((key) => OUTPUTS[key].fieldType === def?.fieldType);
    return matching.find((key) => OUTPUTS[key].output === def?.fieldAi?.output) || matching[0] || 'textarea';
}

export const aiFillOf = (task, def) => task?.aiFieldFills?.[String(def?._id)] || null;

/* A successful fill replaces the whole entry, so a failure still there is newer than the value shown. */
export function aiFillFailure(task, def) {
    const last = aiFillOf(task, def);
    const failed = last?.failed;
    if (!failed?.at) return null;
    return !last.at || new Date(failed.at) >= new Date(last.at) ? failed : null;
}

export function newAiDraft() {
    return {
        _id: '', fieldTitle: '', output: 'textarea', template: 'summary', language: '', prompt: '', reads: [...DEFAULT_READS], autoRefill: false, options: [],
        min: '', max: '', decimals: '', outOfRange: 'clamp', dateRule: '', ratingOnNumber: false, fieldRatingMax: RATING_MAX
    };
}

const settingText = (value) => (value === null || value === undefined || value === '' ? '' : String(value));

export function aiDraftFrom(field) {
    const output = isAiField(field) ? aiOutputOf(field) : 'textarea';
    const config = field?.fieldAi || {};
    return {
        _id: field?._id || '',
        fieldTitle: field?.fieldTitle || '',
        output,
        template: templatesFor(output).includes(config.template) ? config.template : templatesFor(output)[0],
        language: config.language || '',
        prompt: config.prompt || '',
        reads: Array.isArray(config.reads) && config.reads.length ? [...config.reads] : [...DEFAULT_READS],
        autoRefill: config.autoRefill === true,
        options: (field?.fieldOptions || []).map((option) => ({ id: option.id, label: option.label || option.value || '', color: option.color || OPTION_COLOR })),
        min: settingText(config.min),
        max: settingText(config.max),
        decimals: settingText(config.decimals),
        outOfRange: config.outOfRange === 'reject' ? 'reject' : 'clamp',
        dateRule: DATE_RULES.includes(config.dateRule) ? config.dateRule : '',
        ratingOnNumber: output === 'rating' && field?.fieldType !== RATING_FIELD,
        fieldRatingMax: aiRatingMaxOf(field)
    };
}

const labelsOf = (options) => (options || []).map((option) => String(option?.label || '').trim()).filter(Boolean);

const numberOrNull = (value) => {
    const text = String(value ?? '').trim();
    if (!text) return null;
    return NUMBER.test(text) ? Number(text) : NaN;
};

export function validateAiDraft(draft, t) {
    const errors = {};
    if (!String(draft.fieldTitle || '').trim()) errors.fieldTitle = t('AiFields.error_title');
    if (!templatesFor(draft.output).includes(draft.template)) errors.template = t('AiFields.error_template');
    if (draft.template === 'translation' && !String(draft.language || '').trim()) errors.language = t('AiFields.error_language');
    if (draft.template === 'custom' && !String(draft.prompt || '').trim()) errors.prompt = t('AiFields.error_prompt');
    if (OPTION_OUTPUTS.includes(draft.output) && !labelsOf(draft.options).length) errors.options = t('AiFields.error_options');
    if (draft.output === 'number') {
        const min = numberOrNull(draft.min);
        const max = numberOrNull(draft.max);
        if (Number.isNaN(min) || Number.isNaN(max) || (min !== null && max !== null && min > max)) errors.range = t('AiFields.error_range');
        const decimals = numberOrNull(draft.decimals);
        if (decimals !== null && !(Number.isInteger(decimals) && decimals >= 0 && decimals <= DECIMALS_MAX)) errors.decimals = t('AiFields.error_decimals', { max: DECIMALS_MAX });
    }
    if (draft.output === 'rating' && !draft.ratingOnNumber && ratingSettings(draft).error) errors.settings = t('FieldTypes.rating_max_error');
    if (!(draft.reads || []).some((part) => AI_READ_PARTS.includes(part))) errors.reads = t('AiFields.error_reads');
    return errors;
}

const newOptionId = () => Math.random().toString(36).slice(2, 7);
const slug = (label) => label.toLowerCase().replace(/\s+/g, '_');
const bound = (n) => (n === null ? '' : String(n));

export function aiFieldPayload(draft) {
    const title = String(draft.fieldTitle || '').trim();
    const spec = OUTPUTS[draft.output] || OUTPUTS.textarea;
    const onRatingField = draft.output === 'rating' && draft.ratingOnNumber !== true;
    const payload = {
        fieldTitle: title,
        fieldDescription: title,
        fieldPlaceholder: '',
        fieldType: onRatingField ? RATING_FIELD : spec.fieldType,
        type: 'task',
        fieldAi: {
            enabled: true,
            template: draft.template,
            output: spec.output,
            language: draft.template === 'translation' ? String(draft.language || '').trim() : '',
            prompt: String(draft.prompt || '').trim(),
            reads: AI_READ_PARTS.filter((part) => (draft.reads || []).includes(part)),
            autoRefill: draft.autoRefill === true
        },
        updatedAt: new Date()
    };
    if (OPTION_OUTPUTS.includes(draft.output)) {
        payload.fieldOptions = (draft.options || [])
            .map((option) => ({ ...option, label: String(option?.label || '').trim() }))
            .filter((option) => option.label)
            .map((option) => ({ id: option.id || newOptionId(), label: option.label, value: slug(option.label), color: option.color || OPTION_COLOR, selected: false }));
    }
    // The number field's own min and max also hold a value typed in by hand to the same range.
    if (draft.output === 'number') {
        const min = numberOrNull(draft.min);
        const max = numberOrNull(draft.max);
        Object.assign(payload.fieldAi, { min, max, decimals: numberOrNull(draft.decimals), outOfRange: draft.outOfRange === 'reject' ? 'reject' : 'clamp' });
        Object.assign(payload, { fieldMinimum: bound(min), fieldMaximum: bound(max) });
    }
    if (onRatingField) payload.fieldRatingMax = (ratingSettings(draft).settings || ratingSettings({}).settings).fieldRatingMax;
    else if (draft.output === 'rating') Object.assign(payload, { fieldMinimum: '1', fieldMaximum: String(RATING_MAX) });
    if (draft.output === 'date') {
        payload.fieldAi.dateRule = DATE_RULES.includes(draft.dateRule) ? draft.dateRule : '';
        Object.assign(payload, { fieldDateFormate: 'YYYY-MM-DD', fieldTimeFormate: '', fieldPastFuture: ['Past', 'Future'], fieldDaysDisable: [] });
    }
    return payload;
}

/* The tasks a List or Table already loaded, which is what a column's "fill all" means. */
export function loadedViewTasks(getters, projectId, { table = false, searched = false } = {}) {
    const tasks = searched
        ? (getters['projectData/searchedTasks'] || [])
        : flatTasks([getters[table ? 'projectData/tableTasks' : 'projectData/tasks']], projectId);
    return tasks.filter((task) => task?._id && !task.deletedStatusKey);
}

const aiUrl = (fieldId, path) => `${env.CUSTOM_FIELDS_V2}/${fieldId}/ai/${path}`;

const dataOf = (response) => response?.data?.data;

export const previewAiFill = async (fieldId, taskIds) => dataOf(await apiRequest('post', aiUrl(fieldId, 'preview'), { taskIds }));

export const applyAiFill = async (fieldId, proposalIds) => dataOf(await apiRequest('post', aiUrl(fieldId, 'apply'), { proposalIds }));

export const startAiFillJob = async (fieldId, taskIds, proposalIds) => dataOf(await apiRequest('post', aiUrl(fieldId, 'jobs'), { taskIds, proposalIds }));

export const readAiFillJob = async (jobId) => dataOf(await apiRequest('get', `${env.CUSTOM_FIELDS_V2}/ai/jobs/${jobId}`));

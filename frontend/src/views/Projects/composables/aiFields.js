import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { flatTasks } from './projectCustomFields';

export const AI_FIELD_TYPES = ['textarea', 'dropdown'];
export const AI_READ_PARTS = ['title', 'description', 'comments', 'subtasks'];

const TEMPLATES = {
    textarea: ['summary', 'progress_update', 'translation', 'action_items', 'custom'],
    dropdown: ['category', 'custom']
};
const DEFAULT_READS = ['title', 'description'];
const OPTION_COLOR = '#34495E';

export const templatesFor = (output) => [...(TEMPLATES[output] || [])];

export const aiConfigOf = (def) => (def?.fieldAi?.enabled === true && AI_FIELD_TYPES.includes(def?.fieldType) ? def.fieldAi : null);

export const isAiField = (def) => Boolean(aiConfigOf(def));

export const aiFillOf = (task, def) => task?.aiFieldFills?.[String(def?._id)] || null;

export function newAiDraft() {
    return { _id: '', fieldTitle: '', output: 'textarea', template: 'summary', language: '', prompt: '', reads: [...DEFAULT_READS], autoRefill: false, options: [] };
}

export function aiDraftFrom(field) {
    const output = AI_FIELD_TYPES.includes(field?.fieldType) ? field.fieldType : 'textarea';
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
        options: (field?.fieldOptions || []).map((option) => ({ id: option.id, label: option.label || option.value || '', color: option.color || OPTION_COLOR }))
    };
}

const labelsOf = (options) => (options || []).map((option) => String(option?.label || '').trim()).filter(Boolean);

export function validateAiDraft(draft, t) {
    const errors = {};
    if (!String(draft.fieldTitle || '').trim()) errors.fieldTitle = t('AiFields.error_title');
    if (!templatesFor(draft.output).includes(draft.template)) errors.template = t('AiFields.error_template');
    if (draft.template === 'translation' && !String(draft.language || '').trim()) errors.language = t('AiFields.error_language');
    if (draft.template === 'custom' && !String(draft.prompt || '').trim()) errors.prompt = t('AiFields.error_prompt');
    if (draft.output === 'dropdown' && !labelsOf(draft.options).length) errors.options = t('AiFields.error_options');
    if (!(draft.reads || []).some((part) => AI_READ_PARTS.includes(part))) errors.reads = t('AiFields.error_reads');
    return errors;
}

const newOptionId = () => Math.random().toString(36).slice(2, 7);
const slug = (label) => label.toLowerCase().replace(/\s+/g, '_');

export function aiFieldPayload(draft) {
    const title = String(draft.fieldTitle || '').trim();
    const payload = {
        fieldTitle: title,
        fieldDescription: title,
        fieldPlaceholder: '',
        fieldType: draft.output,
        type: 'task',
        fieldAi: {
            enabled: true,
            template: draft.template,
            language: draft.template === 'translation' ? String(draft.language || '').trim() : '',
            prompt: String(draft.prompt || '').trim(),
            reads: AI_READ_PARTS.filter((part) => (draft.reads || []).includes(part)),
            autoRefill: draft.autoRefill === true
        },
        updatedAt: new Date()
    };
    if (draft.output === 'dropdown') {
        payload.fieldOptions = (draft.options || [])
            .map((option) => ({ ...option, label: String(option?.label || '').trim() }))
            .filter((option) => option.label)
            .map((option) => ({ id: option.id || newOptionId(), label: option.label, value: slug(option.label), color: option.color || OPTION_COLOR, selected: false }));
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

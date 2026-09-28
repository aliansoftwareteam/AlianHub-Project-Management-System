const TEMPLATES = Object.freeze({
    SUMMARY: 'summary',
    PROGRESS_UPDATE: 'progress_update',
    TRANSLATION: 'translation',
    ACTION_ITEMS: 'action_items',
    CATEGORY: 'category',
    CUSTOM: 'custom',
});

const TEMPLATES_BY_TYPE = Object.freeze({
    textarea: Object.freeze([TEMPLATES.SUMMARY, TEMPLATES.PROGRESS_UPDATE, TEMPLATES.TRANSLATION, TEMPLATES.ACTION_ITEMS, TEMPLATES.CUSTOM]),
    dropdown: Object.freeze([TEMPLATES.CATEGORY, TEMPLATES.CUSTOM]),
});

const AI_FIELD_TYPES = Object.freeze(Object.keys(TEMPLATES_BY_TYPE));
const READ_PARTS = Object.freeze(['title', 'description', 'comments', 'subtasks']);
const DEFAULT_READS = Object.freeze(['title', 'description']);
const LANGUAGE_MAX = 40;
const PROMPT_MAX = 1000;

class AiConfigError extends Error {}

const text = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/* The one shape stored on a field definition; everything else a client sends is dropped. */
function normaliseAiConfig(raw, fieldType) {
    const given = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    if (given.enabled === false) return { enabled: false };
    const allowed = TEMPLATES_BY_TYPE[fieldType];
    if (!allowed) throw new AiConfigError('Only a long text or dropdown field can be filled by AI.');
    const template = String(given.template || '');
    if (!allowed.includes(template)) throw new AiConfigError(`A ${fieldType} field cannot use the "${template}" AI template.`);

    const reads = given.reads === undefined ? [...DEFAULT_READS] : given.reads;
    if (!Array.isArray(reads) || !reads.length) throw new AiConfigError('An AI field reads at least one part of the task.');
    const unknown = reads.filter((part) => !READ_PARTS.includes(part));
    if (unknown.length) throw new AiConfigError(`An AI field cannot read ${unknown.join(', ')}.`);

    const language = text(given.language, LANGUAGE_MAX);
    if (template === TEMPLATES.TRANSLATION && !language) throw new AiConfigError('A translation field needs the language to translate into.');
    const prompt = typeof given.prompt === 'string' ? given.prompt.trim().slice(0, PROMPT_MAX) : '';
    if (template === TEMPLATES.CUSTOM && !prompt) throw new AiConfigError('A custom AI field needs instructions.');

    return {
        enabled: true,
        template,
        language,
        prompt,
        reads: READ_PARTS.filter((part) => reads.includes(part)),
        autoRefill: given.autoRefill === true,
    };
}

/* A stored definition's config, or null when it is not a usable AI field. */
function aiConfigOf(definition) {
    if (!definition || !definition.fieldAi || definition.fieldAi.enabled !== true) return null;
    try {
        return normaliseAiConfig(definition.fieldAi, definition.fieldType);
    } catch (_error) {
        return null;
    }
}

module.exports = { TEMPLATES, TEMPLATES_BY_TYPE, AI_FIELD_TYPES, READ_PARTS, AiConfigError, normaliseAiConfig, aiConfigOf };

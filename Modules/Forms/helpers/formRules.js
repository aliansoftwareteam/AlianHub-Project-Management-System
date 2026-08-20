// Form rules. Pure — shared by the controller, the public submission handler
// and tests.

const {
    PRIORITIES,
    SPANS,
    TASK_PROPERTIES,
    isType,
    isTaskProperty,
    typeForProperty,
    wantsOptions,
    isInput,
} = require('./questionTypes');

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const HEX_COLOUR_PATTERN = /^#[0-9a-fA-F]{3,8}$/;

const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_QUESTIONS = 50;
const MAX_LABEL_LENGTH = 200;
const MAX_HELP_LENGTH = 500;
const MAX_SUCCESS_LENGTH = 500;
const MAX_OPTIONS = 40;
const MAX_OPTION_LENGTH = 120;

const FORM_STATES = Object.freeze(['draft', 'live']);
const LAYOUTS = Object.freeze(['one', 'two']);
const THEMES = Object.freeze(['light', 'dark']);
const ALIGNMENTS = Object.freeze(['left', 'center', 'right']);

const isObjectIdString = (id) => OBJECT_ID_PATTERN.test(String(id || ''));

const validateFormInput = ({ companyId, title, projectId }) => {
    if (!companyId) return { valid: false, reason: 'companyId is required.' };
    const name = String(title === undefined || title === null ? '' : title).trim();
    if (!name || name.length > MAX_TITLE_LENGTH) {
        return { valid: false, reason: `A title up to ${MAX_TITLE_LENGTH} characters is required.` };
    }
    if (!isObjectIdString(projectId)) return { valid: false, reason: 'A valid projectId is required.' };
    return { valid: true, reason: '' };
};

const normalizeOptions = (raw) => {
    const list = Array.isArray(raw) ? raw.slice(0, MAX_OPTIONS) : [];
    const out = [];
    const seen = new Set();
    for (let i = 0; i < list.length; i += 1) {
        const o = list[i] || {};
        const label = String(o.label === undefined ? o : o.label).trim().slice(0, MAX_OPTION_LENGTH);
        if (!label || seen.has(label)) continue;
        seen.add(label);
        out.push({ id: String(o.id || `o${i + 1}`).slice(0, 40), label });
    }
    return out;
};

/* Forms saved before questions were typed carry {fieldSource, fieldKey}.
 *
 * A task binding becomes a mapping. A custom-field binding becomes a plain text
 * question: Forms no longer reach into custom fields, and dropping the question
 * outright would lose the label someone wrote.
 *
 * A task binding naming a field a form may NOT fill returns null, so the caller
 * refuses it instead of quietly turning it into something else — the old
 * allow-list rejected those too, so no stored form has one, and accepting the
 * shape would give a crafted payload a way around the explicit refusal. */
const migrateLegacy = (q) => {
    const source = String(q.fieldSource || '');
    if (source === 'task') {
        const key = q.fieldKey === 'dueDate' ? 'DueDate' : String(q.fieldKey || '');
        return isTaskProperty(key) ? { mapTo: key, type: typeForProperty(key) } : null;
    }
    return { mapTo: '', type: 'short_text' };
};

/* A stored question, brought up to the current shape.
 *
 * Forms published before questions were typed are still live, and the public
 * page reads their stored list directly — so the migration has to happen on the
 * way OUT as well as on the way in, or an existing form would render and submit
 * against fields it no longer names. */
const hydrateStored = (raw) => (Array.isArray(raw) ? raw : []).map((q) => {
    const stored = (q && q.toObject) ? q.toObject() : (q || {});
    if (stored.type || stored.mapTo) return stored;
    // Unlike a save, a read never refuses: a question that cannot be mapped is
    // shown as plain text and writes nothing, rather than vanishing from a page
    // someone has already published.
    return { ...stored, ...(migrateLegacy(stored) || { mapTo: '', type: 'short_text' }) };
});

/**
 * Validate and normalise the question list.
 *
 * Returns { valid, reason, questions } — the caller stores `questions`, never the
 * raw input. Normalising here is what lets the schema keep `questions` untyped:
 * every field is bounded and re-typed on the way in, so a browser cannot store a
 * question shape the renderer or the submission handler does not expect.
 */
const normalizeQuestions = (raw) => {
    if (raw === undefined || raw === null) return { valid: true, reason: '', questions: [] };
    if (!Array.isArray(raw)) return { valid: false, reason: 'questions must be a list.' };
    if (raw.length > MAX_QUESTIONS) {
        return { valid: false, reason: `A form can hold at most ${MAX_QUESTIONS} questions.` };
    }

    const questions = [];
    const seenIds = new Set();
    const seenProperties = new Set();

    for (let i = 0; i < raw.length; i += 1) {
        const q = raw[i] || {};
        const label = String(q.label === undefined || q.label === null ? '' : q.label).trim();
        if (!label || label.length > MAX_LABEL_LENGTH) {
            return { valid: false, reason: `Question ${i + 1} needs a label up to ${MAX_LABEL_LENGTH} characters.` };
        }

        let mapTo = String(q.mapTo || '');
        let type = String(q.type || '');
        if (!type && !mapTo) {
            const legacy = migrateLegacy(q);
            if (!legacy) {
                return { valid: false, reason: `Question "${label}" is mapped to a task field that a form cannot fill.` };
            }
            ({ mapTo, type } = legacy);
        }

        if (mapTo) {
            if (!isTaskProperty(mapTo)) {
                return { valid: false, reason: `Question "${label}" is mapped to a task field that a form cannot fill.` };
            }
            // The column dictates the widget, so a stale pairing cannot survive
            // a save and the builder never has to keep the two in step.
            type = typeForProperty(mapTo);

            // One question per column. Two writing the same one would race on
            // submit and the loser's answer would silently disappear.
            if (seenProperties.has(mapTo)) {
                return { valid: false, reason: `More than one question fills "${TASK_PROPERTIES[mapTo].title}". Each task field can be asked once.` };
            }
            seenProperties.add(mapTo);
        } else if (!isType(type)) {
            return { valid: false, reason: `Question "${label}" has an unknown type.` };
        }

        let id = String(q.id || '').trim();
        if (!id || seenIds.has(id) || id.length > 40) id = `q${i + 1}_${Date.now().toString(36)}`;
        seenIds.add(id);

        const question = {
            id,
            type,
            mapTo,
            label,
            help: String(q.help || '').trim().slice(0, MAX_HELP_LENGTH),
            required: isInput(type) && q.required === true,
            hidden: q.hidden === true,
            order: i + 1,
        };

        if (wantsOptions(type)) {
            // A fixed-choice column brings its own values; only a form-owned
            // question needs the author to supply them.
            question.options = mapTo && TASK_PROPERTIES[mapTo].values
                ? TASK_PROPERTIES[mapTo].values.map((v) => ({ id: v, label: v }))
                : normalizeOptions(q.options);
            if (!question.options.length) {
                return { valid: false, reason: `Question "${label}" needs at least one option.` };
            }
        }
        if (type === 'rating') {
            const scale = Number(q.max);
            question.max = Number.isInteger(scale) && scale >= 2 && scale <= 10 ? scale : 5;
        }
        // Absent rather than defaulted, so a form that predates widths keeps
        // taking its width from the layout instead of being pinned to one now.
        if (SPANS.includes(Number(q.span))) question.span = Number(q.span);

        questions.push(question);
    }

    return { valid: true, reason: '', questions };
};

/* Presentation only. Nothing here reaches a task, so an unknown value falls back
 * to the default rather than failing a save. */
const normalizeSettings = (input) => {
    const src = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
    const colour = (value, fallback) => (HEX_COLOUR_PATTERN.test(String(value || '')) ? String(value) : fallback);
    return {
        // Defaults to on so a form built before this option existed keeps filing
        // tasks exactly as it did.
        createTask: src.createTask !== false,
        // No longer a control: width is chosen per question. Kept because it is
        // the width a question with no span of its own falls back to, and the
        // default for a newly added one.
        layout: LAYOUTS.includes(String(src.layout)) ? String(src.layout) : 'two',
        theme: THEMES.includes(String(src.theme)) ? String(src.theme) : 'light',
        titleAlign: ALIGNMENTS.includes(String(src.titleAlign)) ? String(src.titleAlign) : 'left',
        titleDivider: src.titleDivider !== false,
        background: colour(src.background, '#f5f6fa'),
        buttonColor: colour(src.buttonColor, '#2f3a8f'),
        answersInDescription: src.answersInDescription !== false,
        showResubmit: src.showResubmit === true,
        hideBranding: src.hideBranding === true,
    };
};

/* Defaults applied to every task a form files. Only the keys we actually read
 * survive, so an arbitrary payload cannot ride along in the stored form. The
 * task type is checked against the project at publish time, not here. */
const normalizeDefaults = (input) => {
    const src = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
    const out = {};
    if (PRIORITIES.includes(String(src.priority))) out.priority = String(src.priority);
    const key = Number(src.taskTypeKey);
    if (Number.isInteger(key) && key > 0) out.taskTypeKey = key;
    return out;
};

/* The task name is what a task is listed by, so a form that FILES TASKS and has
 * no name question would create untitled tasks nobody can find. Checked when
 * such a form goes live and on every edit to one that already is — not on a
 * draft, where a half-built question list is the normal state, and not at all
 * for a form that only collects responses. */
const hasTaskName = (questions) => (Array.isArray(questions) ? questions : [])
    .some((q) => q && q.mapTo === 'TaskName');

const NO_TASK_NAME = 'This form creates a task for each submission, so one question must be mapped to '
    + 'Task Name. Add that question back, or turn off "Create a task for each submission" in Settings.';

/* A form only goes live once it can actually produce a task. */
const validateStateChange = ({ state, questions, sprintId, createTask = true }) => {
    const next = String(state || '');
    if (!FORM_STATES.includes(next)) {
        return { valid: false, reason: `state must be one of: ${FORM_STATES.join(', ')}.` };
    }
    if (next === 'live') {
        if (!Array.isArray(questions) || !questions.length) {
            return { valid: false, reason: 'Add at least one question before publishing.' };
        }
        // A sprint and a task name only matter to a form that files tasks. One
        // that just collects responses needs neither.
        if (createTask) {
            if (!isObjectIdString(sprintId)) {
                return { valid: false, reason: 'Choose where submissions should go before publishing.' };
            }
            if (!hasTaskName(questions)) return { valid: false, reason: NO_TASK_NAME };
        }
    }
    return { valid: true, reason: '' };
};

module.exports = {
    PRIORITIES,
    FORM_STATES,
    LAYOUTS,
    THEMES,
    ALIGNMENTS,
    MAX_TITLE_LENGTH,
    MAX_DESCRIPTION_LENGTH,
    MAX_QUESTIONS,
    MAX_SUCCESS_LENGTH,
    isObjectIdString,
    validateFormInput,
    normalizeQuestions,
    hydrateStored,
    hasTaskName,
    NO_TASK_NAME,
    normalizeOptions,
    normalizeSettings,
    normalizeDefaults,
    validateStateChange,
};

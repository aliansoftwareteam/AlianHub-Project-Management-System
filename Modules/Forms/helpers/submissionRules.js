// Turning a public submission into a task. Pure — no db, no request — so the
// mapping can be tested against hostile input without standing anything up.

const crypto = require('crypto');
const { TASK_PROPERTIES, isTaskProperty, typeOf, isMulti } = require('./questionTypes');
const { escapeHtml } = require('../../PublicShares/helpers/shareRules');

/* The version the manual and AI paths both stamp on a saved block document. */
const EDITORJS_VERSION = '2.30.7';

const MAX_ANSWER_LENGTH = 5000;
const MAX_NAME_ANSWER_LENGTH = 200;

/* Dates arrive as whatever was typed into a date input. Anything unparseable is
 * dropped rather than guessed: a wrong due date is worse than none. */
const toDate = (value) => {
    const d = new Date(String(value || ''));
    return Number.isNaN(d.getTime()) ? null : d;
};

const toNumber = (value) => {
    const n = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
};

const optionLabels = (q) => (Array.isArray(q.options) ? q.options : []).map((o) => o.label);

/* Formats the browser used to check with `type=email` and friends.
 *
 * The page now carries `novalidate`, so its own styled messages are what a
 * submitter sees instead of a native popup — which means these checks have to
 * live here or they would simply stop happening. They are also the only place
 * they can be trusted: the page runs no script and a POST can be hand-made. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const isEmail = (value) => EMAIL_PATTERN.test(value) && value.length <= 254;

/* A scheme-less address is accepted and read as https, the same allowance the
 * shared docs make — "alianhub.com" is what people type. */
const asUrl = (value) => {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
    try {
        const url = new URL(candidate);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        if (!url.hostname.includes('.')) return null;
        return url.href;
    } catch (e) {
        return null;
    }
};

const isPhone = (value) => {
    if (!/^[\d\s+()./-]+$/.test(value)) return false;
    const digits = value.replace(/\D/g, '');
    return digits.length >= 6 && digits.length <= 20;
};

/* Why an answer was rejected, in the submitter's terms. Keyed by widget so a new
 * type of the same shape says the same thing. */
const INVALID_MESSAGE = Object.freeze({
    email: 'Enter a valid email address.',
    url: 'Enter a valid website address.',
    tel: 'Enter a valid phone number.',
    number: 'Enter a number.',
    money: 'Enter an amount.',
    date: 'Enter a valid date.',
    file: 'Choose a file to attach.',
    select: 'Choose one of the options.',
    radio: 'Choose one of the options.',
    checkboxes: 'Choose one of the options.',
    rating: 'Choose a rating.',
    range: 'Enter a value between 0 and 100.',
});

const invalidMessage = (q) => {
    const meta = typeOf(q.type);
    return (meta && INVALID_MESSAGE[meta.widget]) || 'Check this answer.';
};

/* Whether anything was actually typed, as opposed to typed-and-unusable. The two
 * need different messages: "required" versus "that is not an email address". */
const wasGiven = (raw) => {
    if (Array.isArray(raw)) return raw.some((v) => String(v === undefined || v === null ? '' : v).trim() !== '');
    return String(raw === undefined || raw === null ? '' : raw).trim() !== '';
};

/* One answer, coerced to what its type promises. Returns null when the answer is
 * unusable, which is treated as "not given" — a submitter cannot smuggle a value
 * past a type by sending a shape the widget could never produce. */
const coerce = (q, raw, opts) => {
    const meta = typeOf(q.type);
    if (!meta) return null;

    // A file never arrives in the body: it is stored before the mapping runs and
    // handed in as a descriptor, so this stays pure and testable without Wasabi.
    if (meta.widget === 'file') {
        return (opts && opts.files && opts.files.get(q.id)) || null;
    }

    if (isMulti(q.type)) {
        const given = Array.isArray(raw) ? raw : [raw];
        const allowed = optionLabels(q);
        const picked = given
            .map((v) => String(v === undefined || v === null ? '' : v).trim())
            .filter((v) => v && allowed.includes(v));
        return picked.length ? [...new Set(picked)] : null;
    }

    // A repeated key on a single-value question is a crafted payload, not
    // something the rendered form can produce; take the first and move on.
    const one = Array.isArray(raw) ? raw[0] : raw;
    const value = String(one === undefined || one === null ? '' : one).trim();
    if (!value) return null;

    switch (meta.widget) {
        case 'date':
            return toDate(value);
        case 'number':
        case 'money': {
            return toNumber(value);
        }
        case 'range': {
            const n = toNumber(value);
            if (n === null) return null;
            return Math.min(100, Math.max(0, Math.round(n)));
        }
        case 'rating': {
            const n = toNumber(value);
            const top = Number(q.max) || 5;
            if (n === null || n < 1 || n > top) return null;
            return Math.round(n);
        }
        case 'email':
            return isEmail(value) ? value : null;
        case 'url':
            return asUrl(value);
        case 'tel':
            return isPhone(value) ? value : null;
        case 'select':
        case 'radio': {
            // Only a value this question actually offers. Otherwise a hand-made
            // POST could put arbitrary text into a fixed-choice field.
            return optionLabels(q).includes(value) ? value : null;
        }
        default: {
            const cap = q.mapTo === 'TaskName' ? MAX_NAME_ANSWER_LENGTH : MAX_ANSWER_LENGTH;
            return value.slice(0, cap);
        }
    }
};

const asText = (value) => (Array.isArray(value) ? value.join(', ')
    : (value instanceof Date ? value.toISOString().slice(0, 10) : String(value)));

/**
 * Map answers onto the task columns their questions are mapped to.
 *
 * Returns { valid, reason, errors, taskFields, transcript }. `errors` is keyed by
 * question id so the page can mark every offending field at once instead of
 * reporting them one reload at a time.
 *
 * The submitter controls the KEYS as well as the values, so nothing is read from
 * the payload directly: the form's own question list is walked, and an answer is
 * only looked up for a question that exists. A payload naming a field no question
 * maps to is ignored entirely — that is what stops a crafted submission writing
 * an assignee or moving the task to another project.
 */
const mapSubmission = (form, answers, opts) => {
    const questions = Array.isArray(form && form.questions) ? form.questions : [];
    if (!questions.length) return { valid: false, reason: 'This form has no questions.', errors: {} };

    const body = (answers && typeof answers === 'object' && !Array.isArray(answers)) ? answers : {};
    const taskFields = {};
    const transcript = [];
    const attachments = [];
    const errors = {};

    for (const q of questions) {
        const meta = typeOf(q.type);
        if (!meta || meta.input === false || q.hidden) continue;

        const raw = body[q.id];
        const value = coerce(q, raw, opts);
        if (value === null) {
            // A message the handler already produced for this question wins: it
            // says why the file was refused, which is more use than "required".
            if (opts && opts.fileErrors && opts.fileErrors[q.id]) {
                errors[q.id] = opts.fileErrors[q.id];
            } else if (meta.widget === 'file') {
                if (q.required) errors[q.id] = 'This field is required.';
            } else if (wasGiven(raw)) {
                // Typed something unusable is a different failure from nothing.
                errors[q.id] = invalidMessage(q);
            } else if (q.required) {
                errors[q.id] = 'This field is required.';
            }
            continue;
        }

        if (q.mapTo) {
            // Re-checked here even though the builder validated it. This runs on
            // an unauthenticated request, and a form edited before the allow-list
            // tightened would otherwise still be able to write the old column.
            if (!isTaskProperty(q.mapTo)) continue;
            const target = TASK_PROPERTIES[q.mapTo];
            if (target.kind === 'date') {
                if (value instanceof Date) taskFields[target.field] = value;
            } else if (target.kind === 'enum') {
                if (target.values.includes(String(value))) taskFields[target.field] = String(value);
            } else {
                taskFields[target.field] = asText(value).slice(0, target.cap || MAX_ANSWER_LENGTH);
            }
        }

        if (meta.widget === 'file') {
            attachments.push(value);
            // The filename, not the storage key: the key is not a url and leaking
            // its layout into a task description serves nobody.
            transcript.push({ questionId: q.id, label: q.label, value: value.filename, mapped: false, file: value });
            continue;
        }

        transcript.push({ questionId: q.id, label: q.label, value: asText(value), mapped: Boolean(q.mapTo) });
    }

    if (Object.keys(errors).length) {
        // "required" is only right when that is the whole story; a bad email with
        // everything else filled in is not a missing field.
        const onlyMissing = Object.values(errors).every((m) => m === 'This field is required.');
        return {
            valid: false,
            reason: onlyMissing ? 'One or more fields are required.' : 'Please check the highlighted fields.',
            errors,
        };
    }
    // Nothing answered at all is not a submission. Without this, a form whose
    // fields are all optional records an empty row for anyone who clicks Submit —
    // a task-filing form is only saved from it by the task-name rule below.
    // Form-level rather than per-field, because no single field is at fault.
    if (!transcript.length) {
        return {
            valid: false,
            reason: 'Fill in at least one field before submitting.',
            errors,
        };
    }

    // Only a form that files a task needs one. A response-only form has nothing
    // to name.
    const needsName = !opts || opts.requireTaskName !== false;
    if (needsName && !String(taskFields.TaskName || '').trim()) {
        return { valid: false, reason: 'A task name is required.', errors };
    }

    // Every answer, keyed for storage: the response table reads these, so it does
    // not depend on the task that may or may not have been created.
    const record = questions
        .filter((q) => typeOf(q.type) && typeOf(q.type).input !== false && !q.hidden)
        .map((q) => ({ questionId: q.id, label: q.label, value: '' }));
    for (const row of record) {
        const hit = transcript.find((tItem) => tItem.questionId === row.questionId);
        if (hit) {
            row.value = hit.value;
            if (hit.file) row.file = hit.file;
        }
    }

    return { valid: true, reason: '', errors, taskFields, transcript, record, attachments };
};

/**
 * Every answer, as plain text, for the task description.
 *
 * The answers stay readable on the task even for questions that fill no column,
 * so nothing a submitter typed is lost. A question mapped to the description
 * supplies the body, and the transcript follows it.
 */
const buildDescription = (transcript, body) => {
    const lines = (Array.isArray(transcript) ? transcript : []).map((t) => `${t.label}: ${t.value}`);
    const head = String(body || '').trim();
    if (!head) return lines.join('\n');
    return lines.length ? `${head}\n\n${lines.join('\n')}` : head;
};

/**
 * The description as the task editor stores it.
 *
 * A task's description is read from `descriptionBlock` — an Editor.js document —
 * and `rawDescription` is only the plain-text mirror used by search. Writing just
 * the latter left the description blank on the task, which is what happened here.
 *
 * Built locally rather than importing the AI generator's `wrapDescriptionBlock`:
 * that module pulls in socket emitters, notifications and an AI estimator at
 * require time, none of which belong on an unauthenticated submission path. The
 * shape is the contract, and it is asserted in the tests.
 *
 * Editor.js inserts a paragraph's `text` as HTML, and this text is whatever an
 * anonymous submitter typed, so every line is escaped on the way in.
 */
const buildDescriptionBlock = (text) => {
    const body = String(text === undefined || text === null ? '' : text);
    if (!body.trim()) return {};
    return {
        time: Date.now(),
        version: EDITORJS_VERSION,
        blocks: body.split('\n').map((line) => ({
            id: crypto.randomBytes(6).toString('hex').slice(0, 10),
            type: 'paragraph',
            data: { text: escapeHtml(line) },
        })),
    };
};

module.exports = {
    mapSubmission,
    isEmail,
    asUrl,
    isPhone,
    buildDescription,
    buildDescriptionBlock,
    coerce,
    MAX_ANSWER_LENGTH,
};

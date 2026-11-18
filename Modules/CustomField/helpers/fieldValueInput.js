const { DateTime } = require('luxon');
const { typeModuleOf } = require('../fieldTypes');

/* A value handed over as JSON by a caller that has no form (an agent), as the field's type stores it.
 * The types with a module of their own are checked by that module when the value is written. */

const TEXT_MAX = 4000;
const NUMERIC = /^[-+]?\d+(\.\d+)?$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COMPUTED = Object.freeze(['formula', 'rollup']);

const isBlank = (value) => value === null || value === undefined || value === '';

const optionsOf = (definition) => (Array.isArray(definition.fieldOptions) ? definition.fieldOptions : []).filter((option) => option && option.id !== undefined);
const optionLabel = (option) => String(option.label || option.value || '').trim();

const optionNamed = (definition, wanted) => {
    const text = String(wanted).trim().toLowerCase();
    return optionsOf(definition).find((option) => String(option.id) === String(wanted).trim() || optionLabel(option).toLowerCase() === text);
};

const textValue = (value) => (typeof value === 'string' && value.length <= TEXT_MAX
    ? { value }
    : { error: `needs text of at most ${TEXT_MAX} characters` });

const numberValue = (value) => {
    const n = typeof value === 'string' && NUMERIC.test(value.trim()) ? Number(value) : value;
    return typeof n === 'number' && Number.isFinite(n) ? { value: String(n) } : { error: 'needs a number' };
};

const dateValue = (value, definition, { zone = 'UTC' } = {}) => {
    const text = typeof value === 'string' ? value.trim() : '';
    const at = ISO_DAY.test(text) ? DateTime.fromISO(text, { zone }).startOf('day') : DateTime.fromISO(text, { setZone: true });
    return text && at.isValid ? { value: at.toUTC().toISO() } : { error: 'needs a date as YYYY-MM-DD or an ISO date and time' };
};

const dropdownValue = (value, definition) => {
    const wanted = Array.isArray(value) ? value : [value];
    if (wanted.some((item) => typeof item !== 'string' && typeof item !== 'number')) return { error: 'needs an option, or a list of options, by id or label' };
    const chosen = wanted.map((item) => optionNamed(definition, item));
    if (chosen.includes(undefined)) return { error: `needs one of its options: ${optionsOf(definition).map(optionLabel).join(', ') || 'it has none'}` };
    return { value: [...new Set(chosen.map((option) => String(option.id)))] };
};

const BY_TYPE = Object.freeze({
    text: textValue,
    textarea: textValue,
    number: numberValue,
    money: numberValue,
    checkbox: (value) => (typeof value === 'boolean' ? { value } : { error: 'needs true or false' }),
    email: (value) => (typeof value === 'string' && value.length <= 254 && EMAIL.test(value) ? { value } : { error: 'needs an email address' }),
    date: dateValue,
    dropdown: dropdownValue,
});

const EMPTY = Object.freeze({ dropdown: [], checkbox: false });

/* { value } as stored, or { error } saying what the field needs. */
const storedValueOf = (definition, value, context = {}) => {
    const type = String((definition && definition.fieldType) || '');
    if (COMPUTED.includes(type)) return { error: 'is computed and cannot be set' };
    const module = typeModuleOf(type);
    if (module && module.castOnly) return { error: 'holds votes, which people cast in the app' };
    if (module && module.sideStored) return { error: 'holds linked tasks, which are linked in the app' };
    if (module) return { value: value === undefined ? null : value };
    const read = BY_TYPE[type];
    if (!read) return { error: `is a ${type || 'field'} field, which cannot be set here yet` };
    if (isBlank(value)) return { value: Object.hasOwn(EMPTY, type) ? EMPTY[type] : '' };
    return read(value, definition, context);
};

/* A definition switched off stores isDelete false; the task panel offers the rest where the field is company-wide or names the project. */
const isTaskFieldOf = (definition, projectId) => Boolean(definition) && definition.isDelete !== false && definition.type === 'task'
    && (definition.global === true || [].concat(definition.projectId || []).map(String).includes(String(projectId)));

module.exports = { TEXT_MAX, storedValueOf, optionsOf, optionLabel, isTaskFieldOf };

const { DateTime } = require('luxon');

const OUTPUT = Object.freeze({ TEXT: 'text', OPTION: 'option', LABELS: 'labels', NUMBER: 'number', RATING: 'rating', DATE: 'date' });

const OUTPUTS_BY_TYPE = Object.freeze({
    textarea: Object.freeze([OUTPUT.TEXT]),
    dropdown: Object.freeze([OUTPUT.OPTION, OUTPUT.LABELS]),
    number: Object.freeze([OUTPUT.NUMBER, OUTPUT.RATING]),
    date: Object.freeze([OUTPUT.DATE]),
});

const OUT_OF_RANGE = Object.freeze({ CLAMP: 'clamp', REJECT: 'reject' });
const DATE_RULES = Object.freeze(['', 'after_start', 'not_past']);
const REASON = Object.freeze({ NO_ANSWER: 'no_answer', NO_FIT: 'no_fit', INVALID: 'invalid', OUT_OF_RANGE: 'out_of_range', DATE_RULE: 'date_rule' });

const DECIMALS_MAX = 6;
const RATING_MAX = 5;
const TEXT_CAP = 4000;
const MAX_ITEMS = 15;
const MAX_OPTIONS = 60;
const NUMERIC = /^[-+]?\d+(\.\d+)?$/;
const ISO_DAY = /^(\d{4}-\d{2}-\d{2})(?:$|T)/;

const optionLabel = (option) => String((option && (option.label || option.value)) || '').trim();

const optionsOf = (definition) => (Array.isArray(definition.fieldOptions) ? definition.fieldOptions : [])
    .filter((option) => option && option.id !== undefined && optionLabel(option))
    .slice(0, MAX_OPTIONS);

const optionNamed = (definition, name) => {
    const wanted = typeof name === 'string' ? name.trim().toLowerCase() : '';
    return wanted ? optionsOf(definition).find((option) => [optionLabel(option), String(option.value || '')]
        .some((candidate) => candidate.trim().toLowerCase() === wanted)) : undefined;
};

const isBlank = (value) => value === null || value === undefined || (typeof value === 'string' && !value.trim());

/* A number the model wrote, or NaN; "1,200" is read as 1200, "3 hours" is not a number. */
function numberFrom(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    if (typeof value !== 'string') return NaN;
    const clean = value.replace(/,/g, '').trim();
    return NUMERIC.test(clean) ? Number(clean) : NaN;
}

const rounded = (n, decimals) => {
    const fixed = Number(n.toFixed(decimals));
    return Object.is(fixed, -0) ? 0 : fixed;
};

const filled = (fieldValue, text) => ({ fieldValue, text, empty: false });

function blank(output, reason) {
    const fieldValue = [OUTPUT.OPTION, OUTPUT.LABELS].includes(output) ? [] : '';
    return { fieldValue, text: '', empty: true, reason };
}

const rejected = (output, reason = REASON.INVALID) => ({ ...blank(output, reason), invalid: true });

function asText(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item == null ? '' : item).replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, MAX_ITEMS).map((item) => `- ${item}`).join('\n');
    }
    if (value === null || value === undefined || typeof value === 'object') return '';
    return String(value).trim();
}

function parseText(value) {
    const text = asText(value);
    const capped = text.length > TEXT_CAP ? `${text.slice(0, TEXT_CAP)}…` : text;
    return capped ? filled(capped, capped) : blank(OUTPUT.TEXT, REASON.NO_ANSWER);
}

/* An answer outside the dropdown's options is dropped rather than coerced: the field stays empty. */
function parseOption(value, { definition }) {
    const option = optionNamed(definition, value);
    return option ? filled([String(option.id)], optionLabel(option)) : blank(OUTPUT.OPTION, REASON.NO_FIT);
}

function parseLabels(value, { definition }) {
    if (value === null || value === undefined) return blank(OUTPUT.LABELS, REASON.NO_FIT);
    const names = typeof value === 'string' ? [value] : value;
    if (!Array.isArray(names) || names.some((name) => typeof name !== 'string')) return rejected(OUTPUT.LABELS);
    const chosen = [];
    names.map((name) => optionNamed(definition, name)).forEach((option) => {
        if (option && !chosen.includes(option)) chosen.push(option);
    });
    if (!chosen.length) return blank(OUTPUT.LABELS, REASON.NO_FIT);
    return filled(chosen.map((option) => String(option.id)), chosen.map(optionLabel).join(', '));
}

function parseNumber(value, { config }) {
    if (isBlank(value)) return blank(OUTPUT.NUMBER, REASON.NO_ANSWER);
    let n = numberFrom(value);
    if (Number.isNaN(n)) return rejected(OUTPUT.NUMBER);
    n = rounded(n, config.decimals === null || config.decimals === undefined ? DECIMALS_MAX : config.decimals);
    const below = config.min !== null && config.min !== undefined && n < config.min;
    const above = config.max !== null && config.max !== undefined && n > config.max;
    if ((below || above) && config.outOfRange === OUT_OF_RANGE.REJECT) return rejected(OUTPUT.NUMBER, REASON.OUT_OF_RANGE);
    if (below) n = config.min;
    if (above) n = config.max;
    return filled(String(n), String(n));
}

function parseRating(value) {
    if (isBlank(value)) return blank(OUTPUT.RATING, REASON.NO_ANSWER);
    const n = numberFrom(value);
    if (Number.isNaN(n)) return rejected(OUTPUT.RATING);
    const whole = Math.round(n);
    if (whole < 1 || whole > RATING_MAX) return rejected(OUTPUT.RATING, REASON.OUT_OF_RANGE);
    return filled(String(whole), String(whole));
}

/* The day is stored as its start in the zone of the person filling, as the date picker stores a picked day. */
function parseDate(value, { config, context }) {
    if (isBlank(value)) return blank(OUTPUT.DATE, REASON.NO_ANSWER);
    const day = typeof value === 'string' ? (value.trim().match(ISO_DAY) || [])[1] : undefined;
    const date = day ? DateTime.fromISO(day, { zone: context.zone }) : null;
    if (!date || !date.isValid) return rejected(OUTPUT.DATE);
    if (config.dateRule === 'after_start' && context.startDate && day < context.startDate) return rejected(OUTPUT.DATE, REASON.DATE_RULE);
    if (config.dateRule === 'not_past' && day < context.today) return rejected(OUTPUT.DATE, REASON.DATE_RULE);
    return filled(date.startOf('day').toUTC().toISO(), day);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function numberFormat(config) {
    const { min, max, decimals } = config;
    const has = (n) => n !== null && n !== undefined;
    let range = '';
    if (has(min) && has(max)) range = ` between ${min} and ${max}`;
    else if (has(min)) range = ` of at least ${min}`;
    else if (has(max)) range = ` of at most ${max}`;
    let places = '';
    if (decimals === 0) places = ', a whole number';
    else if (has(decimals)) places = `, with at most ${plural(decimals, 'decimal place')}`;
    return `The value is a single number${range}${places}: digits only, "." for decimals, no units and no thousands separators. It is null when the task gives no basis for one.`;
}

function dateFormat(config, context) {
    const lines = ['The value is one calendar date written as "YYYY-MM-DD", or null when the task gives no basis for one. Work out relative dates such as "next Friday" from today\'s date.'];
    if (config.dateRule === 'after_start' && context.startDate) lines.push(`The date must be on or after the task's start date, ${context.startDate}.`);
    if (config.dateRule === 'not_past') lines.push(`The date must be today, ${context.today}, or later.`);
    return lines.join(' ');
}

/* `stated` outputs have templates that already say the value's format; the rest always add their format line. */
const SPECS = Object.freeze({
    [OUTPUT.TEXT]: { stated: true, temperature: 0.3, format: () => 'The value is a plain-text string.', parse: parseText },
    [OUTPUT.OPTION]: {
        stated: true,
        temperature: 0.1,
        optionsHeading: 'Options (choose one, or null)',
        format: () => 'The value is exactly one of the options, copied exactly as written, or null when none fits.',
        parse: parseOption,
    },
    [OUTPUT.LABELS]: {
        temperature: 0.1,
        optionsHeading: 'Options (choose every one that applies)',
        format: () => 'The value is an array of every option that applies, each copied exactly as written, or an empty array when none fits. Never add anything that is not an option.',
        parse: parseLabels,
    },
    [OUTPUT.NUMBER]: { temperature: 0.1, format: numberFormat, parse: parseNumber },
    [OUTPUT.RATING]: {
        temperature: 0.1,
        format: () => `The value is a whole number from 1 to ${RATING_MAX}, where 1 is the lowest and ${RATING_MAX} the highest, or null when the task gives no basis for a rating.`,
        parse: parseRating,
    },
    [OUTPUT.DATE]: { temperature: 0.1, format: dateFormat, parse: parseDate, needsDates: true },
});

const specOf = (output) => SPECS[output] || SPECS[OUTPUT.TEXT];

const finiteOrNull = (raw) => {
    if (raw === null || raw === undefined || raw === '') return null;
    const n = typeof raw === 'number' ? raw : numberFrom(String(raw));
    return Number.isFinite(n) ? n : undefined;
};

/* The settings stored for an output, or `{ error }` naming what is wrong with them. */
function settingsFor(output, given) {
    if (output === OUTPUT.NUMBER) {
        const min = finiteOrNull(given.min);
        const max = finiteOrNull(given.max);
        if (min === undefined || max === undefined) return { error: 'The range of an AI number field must be numbers.' };
        if (min !== null && max !== null && min > max) return { error: 'The minimum of an AI number field is above its maximum.' };
        const decimals = given.decimals === null || given.decimals === undefined || given.decimals === '' ? null : Number(given.decimals);
        if (decimals !== null && !(Number.isInteger(decimals) && decimals >= 0 && decimals <= DECIMALS_MAX)) {
            return { error: `An AI number field keeps 0 to ${DECIMALS_MAX} decimal places.` };
        }
        const outOfRange = given.outOfRange === undefined || given.outOfRange === '' ? OUT_OF_RANGE.CLAMP : given.outOfRange;
        if (!Object.values(OUT_OF_RANGE).includes(outOfRange)) return { error: 'An AI number field either clamps or rejects an answer outside its range.' };
        return { settings: { min, max, decimals, outOfRange } };
    }
    if (output === OUTPUT.DATE) {
        const dateRule = given.dateRule === undefined || given.dateRule === null ? '' : given.dateRule;
        if (!DATE_RULES.includes(dateRule)) return { error: `An AI date field cannot use the "${dateRule}" rule.` };
        return { settings: { dateRule } };
    }
    return { settings: {} };
}

module.exports = {
    OUTPUT,
    OUTPUTS_BY_TYPE,
    OUT_OF_RANGE,
    DATE_RULES,
    REASON,
    RATING_MAX,
    optionLabel,
    optionsOf,
    specOf,
    settingsFor,
    blank,
    rejected,
};

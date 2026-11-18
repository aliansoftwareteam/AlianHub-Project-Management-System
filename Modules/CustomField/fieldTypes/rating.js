const { isBlank, wholeNumberOf } = require('./shared');

const DEFAULT_MAX = 5;
const MAX_RANGE = Object.freeze({ min: 3, max: 10 });

const maxOf = (definition) => {
    const max = wholeNumberOf(definition && definition.fieldRatingMax);
    return max !== null && max >= MAX_RANGE.min && max <= MAX_RANGE.max ? max : DEFAULT_MAX;
};

function settings(definition) {
    const given = definition.fieldRatingMax;
    if (isBlank(given)) return { settings: { fieldRatingMax: DEFAULT_MAX } };
    const max = wholeNumberOf(given);
    if (max === null || max < MAX_RANGE.min || max > MAX_RANGE.max) return { error: `A rating's maximum is a whole number from ${MAX_RANGE.min} to ${MAX_RANGE.max}.` };
    return { settings: { fieldRatingMax: max } };
}

function parse(value, definition) {
    if (isBlank(value)) return { value: '' };
    const max = maxOf(definition);
    const rating = wholeNumberOf(value);
    if (rating === null || rating < 1 || rating > max) return { error: `A rating is a whole number from 1 to ${max}.` };
    return { value: rating };
}

/* A value stored before the maximum was lowered shows as the maximum. */
const shownOf = (value, definition) => {
    const rating = wholeNumberOf(value);
    return rating === null || rating < 1 ? null : Math.min(rating, maxOf(definition));
};

function text(value, definition) {
    const rating = shownOf(value, definition);
    return rating === null ? '' : `${rating}/${maxOf(definition)}`;
}

const sortValue = (value, definition) => shownOf(value, definition);

module.exports = { type: 'rating', empty: '', DEFAULT_MAX, MAX_RANGE, maxOf, shownOf, settings, parse, text, sortValue };

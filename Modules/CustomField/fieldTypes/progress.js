const { isBlank, wholeNumberOf } = require('./shared');

const RANGE = Object.freeze({ min: 0, max: 100 });

const settings = () => ({ settings: {} });

function parse(value) {
    if (isBlank(value)) return { value: '' };
    const percent = wholeNumberOf(value);
    if (percent === null || percent < RANGE.min || percent > RANGE.max) return { error: `Progress is a whole number from ${RANGE.min} to ${RANGE.max}.` };
    return { value: percent };
}

const shownOf = (value) => {
    const percent = wholeNumberOf(value);
    return percent === null ? null : Math.min(Math.max(percent, RANGE.min), RANGE.max);
};

function text(value) {
    const percent = shownOf(value);
    return percent === null ? '' : `${percent}%`;
}

const sortValue = (value) => shownOf(value);

module.exports = { type: 'progress', empty: '', RANGE, shownOf, settings, parse, text, sortValue };

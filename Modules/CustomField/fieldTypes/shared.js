const isBlank = (value) => value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);

const WHOLE = /^-?\d+$/;

/* A whole number sent as a number or as its digits, or null. */
const wholeNumberOf = (value) => {
    if (typeof value === 'number') return Number.isInteger(value) ? value : null;
    if (typeof value !== 'string' || !WHOLE.test(value.trim())) return null;
    const number = Number(value.trim());
    return Number.isSafeInteger(number) ? number : null;
};

module.exports = { isBlank, wholeNumberOf };

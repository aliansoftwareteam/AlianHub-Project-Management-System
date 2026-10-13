const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

// A signed number such as "-12.5" is left alone: a spreadsheet reads it as that
// number, and prefixing it would turn every negative report figure into text.
const neutraliseFormula = (value) => {
    if (typeof value !== 'string' || !FORMULA_TRIGGER.test(value) || PLAIN_NUMBER.test(value)) return value;
    return `'${value}`;
};

module.exports = { neutraliseFormula };

const { isBlank } = require('./shared');

const USER_ID = /^[a-f0-9]{24}$/i;
const MAX_PEOPLE = 50;

const NOT_A_LIST = 'A people field holds a list of people.';
const ONE_PERSON = 'This field holds one person.';

const isMultiple = (definition) => !definition || definition.fieldMultiple !== false;

const idsOf = (value) => (Array.isArray(value) ? value.filter((id) => typeof id === 'string' && USER_ID.test(id)) : []);

function settings(definition) {
    const given = definition.fieldMultiple;
    if (given !== undefined && typeof given !== 'boolean') return { error: 'fieldMultiple must be true or false.' };
    return { settings: { fieldMultiple: given !== false } };
}

/* Whether each person may be named on this task is the server's to answer; this checks the shape alone. */
function parse(value, definition) {
    if (isBlank(value)) return { value: [] };
    if (!Array.isArray(value) || value.length > MAX_PEOPLE || value.some((id) => typeof id !== 'string' || !USER_ID.test(id))) return { error: NOT_A_LIST };
    const ids = [...new Set(value.map((id) => id.toLowerCase()))];
    if (ids.length > 1 && !isMultiple(definition)) return { error: ONE_PERSON };
    return { value: ids };
}

const namesOf = (value, context) => {
    const userName = context && typeof context.userName === 'function' ? context.userName : () => '';
    return idsOf(value).map((id) => userName(id)).filter((name) => typeof name === 'string' && name.trim());
};

const text = (value, definition, context) => namesOf(value, context).join(', ');

function sortValue(value, definition, context) {
    const first = idsOf(value)[0];
    const name = first ? namesOf([first], context)[0] : '';
    return name ? name.trim().toLowerCase() : null;
}

module.exports = { type: 'people', empty: Object.freeze([]), MAX_PEOPLE, isMultiple, idsOf, settings, parse, text, sortValue };

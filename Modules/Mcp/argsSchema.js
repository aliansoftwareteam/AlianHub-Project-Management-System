// The arguments of a tool checked against the schema it publishes: a key the schema does not name,
// a missing required one or a value of the wrong type, length or range is refused before anything runs.

const ANY_VALUE_MAX = 20000;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const TYPES = Object.freeze({
    string: (value) => typeof value === 'string',
    integer: (value) => Number.isInteger(value),
    number: (value) => typeof value === 'number' && Number.isFinite(value),
    boolean: (value) => typeof value === 'boolean',
    array: Array.isArray,
    object: isPlainObject,
    null: (value) => value === null,
});

const list = (names) => `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'}`;

const problemAt = (path, schema, value) => {
    const types = [].concat(schema.type || []);
    if (!types.length) return JSON.stringify(value === undefined ? null : value).length > ANY_VALUE_MAX ? `${path} is too large` : '';
    if (!types.some((type) => TYPES[type] && TYPES[type](value))) return `${path} must be ${types.join(' or ')}`;
    if (typeof value === 'string') {
        if (schema.minLength !== undefined && value.length < schema.minLength) return `${path} must have at least ${schema.minLength} character${schema.minLength === 1 ? '' : 's'}`;
        if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${path} must have at most ${schema.maxLength} characters`;
        if (schema.enum && !schema.enum.includes(value)) return `${path} must be one of ${schema.enum.join(', ')}`;
        if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `${path} is not in the form this tool takes`;
    }
    if (typeof value === 'number') {
        if (schema.minimum !== undefined && value < schema.minimum) return `${path} must be at least ${schema.minimum}`;
        if (schema.maximum !== undefined && value > schema.maximum) return `${path} must be at most ${schema.maximum}`;
    }
    if (Array.isArray(value)) {
        if (schema.minItems !== undefined && value.length < schema.minItems) return `${path} must have at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}`;
        if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${path} must have at most ${schema.maxItems} items`;
        if (schema.items) return value.map((item, at) => problemAt(`${path}[${at}]`, schema.items, item)).find(Boolean) || '';
    }
    if (isPlainObject(value) && schema.properties) return within(path, schema, value);
    return '';
};

const within = (path, schema, value) => {
    const at = (key) => (path ? `${path}.${key}` : key);
    const unknown = Object.keys(value).filter((key) => !Object.hasOwn(schema.properties, key));
    if (unknown.length) return `${list(unknown.map(at))} not an argument of this tool`;
    const missing = (schema.required || []).filter((key) => value[key] === undefined);
    if (missing.length) return `${list(missing.map(at))} required`;
    return Object.keys(value).filter((key) => value[key] !== undefined).map((key) => problemAt(at(key), schema.properties[key], value[key])).find(Boolean) || '';
};

/* '' when `args` fit `schema`; otherwise the first thing wrong with them. `also` are properties the caller adds to every such tool. */
const problemIn = (schema, args, also = {}) => {
    if (!isPlainObject(args)) return 'the arguments must be an object';
    return within('', { ...schema, properties: { ...(schema.properties || {}), ...also } }, args);
};

module.exports = { problemIn };

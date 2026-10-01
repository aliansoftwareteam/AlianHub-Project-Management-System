const { VISIBILITIES } = require('./goalAccess');

const MAX_TARGETS = 20;
const MAX_NAME = 120;
const MAX_DESCRIPTION = 2000;
const MAX_UNIT = 20;
const MAX_SHARED = 100;
const MAX_WEIGHT = 100;
const MAX_AMOUNT = 1e15;
const MAX_GOALS_PER_OWNER = 200;

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const CURRENCY_CODE = /^[A-Z]{3}$/;

const NUMBER = 'number';
const CURRENCY = 'currency';
const BOOLEAN = 'boolean';
const TARGET_KINDS = Object.freeze([NUMBER, CURRENCY, BOOLEAN]);

const CREATE_KEYS = Object.freeze(['name', 'description', 'periodStart', 'periodEnd', 'visibility', 'sharedWith', 'color', 'targets']);
const UPDATE_KEYS = Object.freeze(['name', 'description', 'periodStart', 'periodEnd', 'visibility', 'sharedWith', 'color', 'ownerUserId']);

const MEASURED_KEYS = ['name', 'kind', 'weight', 'start', 'target', 'current', 'unit'];
const TARGET_KEYS = Object.freeze({
    [NUMBER]: MEASURED_KEYS,
    [CURRENCY]: [...MEASURED_KEYS, 'currencyCode'],
    [BOOLEAN]: ['name', 'kind', 'weight', 'done'],
});
const VALUE_KEY = Object.freeze({ [NUMBER]: 'current', [CURRENCY]: 'current', [BOOLEAN]: 'done' });
const definitionKeys = (kind) => TARGET_KEYS[kind].filter((key) => key !== 'kind' && key !== VALUE_KEY[kind]);

class GoalRefused extends Error {
    constructor(field, reason) {
        super(`${field} ${reason}`);
        this.name = 'GoalRefused';
        this.field = field;
    }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));

const onlyKnownKeys = (body, known, at = '') => {
    if (!isPlainObject(body)) throw new GoalRefused(at ? at.slice(0, -1) : 'body', 'must be an object');
    const unknown = Object.keys(body).find((key) => !known.includes(key));
    if (unknown !== undefined) throw new GoalRefused(`${at}${unknown}`, 'is not a known key');
};

const nameOf = (value, field) => {
    const trimmed = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
    if (!trimmed || trimmed.length > MAX_NAME) throw new GoalRefused(field, `must be 1 to ${MAX_NAME} characters`);
    return trimmed;
};

const textOf = (value, field, max) => {
    if (typeof value !== 'string' || value.trim().length > max) throw new GoalRefused(field, `must be text of at most ${max} characters`);
    return value.trim();
};

const dayOf = (value, field) => {
    if (value === '' || value === null) return '';
    const parts = typeof value === 'string' ? DAY.exec(value) : null;
    const date = parts ? new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))) : null;
    if (!date || date.toISOString().slice(0, 10) !== value) throw new GoalRefused(field, 'must be a date written as YYYY-MM-DD, or empty');
    return value;
};

const amountOf = (value, field) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_AMOUNT) throw new GoalRefused(field, 'must be a number');
    return value;
};

const weightOf = (value, field) => {
    if (!Number.isInteger(value) || value < 1 || value > MAX_WEIGHT) throw new GoalRefused(field, `must be a whole number from 1 to ${MAX_WEIGHT}`);
    return value;
};

const flagOf = (value, field) => {
    if (typeof value !== 'boolean') throw new GoalRefused(field, 'must be true or false');
    return value;
};

const peopleOf = (value, field) => {
    if (!Array.isArray(value) || value.length > MAX_SHARED || !value.every((id) => typeof id === 'string' && OBJECT_ID.test(id))) {
        throw new GoalRefused(field, `must be a list of at most ${MAX_SHARED} member ids`);
    }
    return [...new Set(value)];
};

const FIELD_RULES = Object.freeze({
    name: nameOf,
    description: (value, field) => textOf(value, field, MAX_DESCRIPTION),
    periodStart: dayOf,
    periodEnd: dayOf,
    visibility: (value, field) => {
        if (!VISIBILITIES.includes(value)) throw new GoalRefused(field, `must be one of ${VISIBILITIES.join(', ')}`);
        return value;
    },
    sharedWith: peopleOf,
    color: (value, field) => {
        if (value !== '' && !(typeof value === 'string' && COLOR.test(value))) throw new GoalRefused(field, 'must be a colour written as #rrggbb, or empty');
        return value;
    },
    ownerUserId: (value, field) => {
        if (typeof value !== 'string' || !OBJECT_ID.test(value)) throw new GoalRefused(field, 'must be a member id');
        return value;
    },
});

const TARGET_RULES = Object.freeze({
    name: nameOf,
    weight: weightOf,
    start: amountOf,
    target: amountOf,
    current: amountOf,
    unit: (value, field) => textOf(value, field, MAX_UNIT),
    currencyCode: (value, field) => {
        if (typeof value !== 'string' || !CURRENCY_CODE.test(value)) throw new GoalRefused(field, 'must be a three-letter currency code');
        return value;
    },
    done: flagOf,
});

const checked = (body, rules, at = '') => Object.fromEntries(Object.keys(body)
    .filter((key) => body[key] !== undefined && Object.hasOwn(rules, key))
    .map((key) => [key, rules[key](body[key], `${at}${key}`)]));

const requireRange = (target, at = '') => {
    if (target.start === target.target) throw new GoalRefused(`${at}target`, 'must differ from start');
};

/* A new target, complete: the value starts where the range starts unless the request says otherwise. */
const parseNewTarget = (body, at = '') => {
    if (!isPlainObject(body)) throw new GoalRefused(at ? at.slice(0, -1) : 'body', 'must be an object');
    if (!TARGET_KINDS.includes(body.kind)) throw new GoalRefused(`${at}kind`, `must be one of ${TARGET_KINDS.join(', ')}`);
    const { kind } = body;
    onlyKnownKeys(body, TARGET_KEYS[kind], at);
    const fields = checked(body, TARGET_RULES, at);
    if (fields.name === undefined) throw new GoalRefused(`${at}name`, 'is required');
    const base = { name: fields.name, kind, weight: fields.weight === undefined ? 1 : fields.weight };
    if (kind === BOOLEAN) return { ...base, done: fields.done === true };
    if (fields.target === undefined) throw new GoalRefused(`${at}target`, 'is required');
    if (kind === CURRENCY && fields.currencyCode === undefined) throw new GoalRefused(`${at}currencyCode`, 'is required');
    const start = fields.start === undefined ? 0 : fields.start;
    const target = {
        ...base,
        start,
        target: fields.target,
        current: fields.current === undefined ? start : fields.current,
        unit: fields.unit || '',
        ...(kind === CURRENCY ? { currencyCode: fields.currencyCode } : {}),
    };
    requireRange(target, at);
    return target;
};

/* A change to what a target is. Its kind is fixed, and its value has a route of its own. */
const parseTargetEdit = (body, stored) => {
    onlyKnownKeys(body, definitionKeys(stored.kind));
    const fields = checked(body, TARGET_RULES);
    if (!Object.keys(fields).length) throw new GoalRefused('body', 'names nothing to change');
    const edited = { ...stored, ...fields };
    if (stored.kind !== BOOLEAN) requireRange(edited);
    return edited;
};

const parseTargetValue = (body, stored) => {
    const key = VALUE_KEY[stored.kind];
    onlyKnownKeys(body, [key]);
    if (body[key] === undefined) throw new GoalRefused(key, 'is required');
    return { [key]: TARGET_RULES[key](body[key], key) };
};

const parseTargets = (value) => {
    if (!Array.isArray(value) || value.length > MAX_TARGETS) throw new GoalRefused('targets', `must be a list of at most ${MAX_TARGETS} targets`);
    return value.map((target, index) => parseNewTarget(target, `targets.${index}.`));
};

const parseGoalBody = (body, { creating = false } = {}) => {
    onlyKnownKeys(body, creating ? CREATE_KEYS : UPDATE_KEYS);
    const fields = checked(body, FIELD_RULES);
    if (body.targets !== undefined) fields.targets = parseTargets(body.targets);
    if (creating && fields.name === undefined) throw new GoalRefused('name', 'is required');
    if (!Object.keys(fields).length) throw new GoalRefused('body', 'names nothing to change');
    return fields;
};

/* Read on the goal as it will be stored, so a change to one end of the period is held against the other. */
const requirePeriodInOrder = (goal) => {
    if (goal.periodStart && goal.periodEnd && goal.periodEnd < goal.periodStart) throw new GoalRefused('periodEnd', 'must not be before periodStart');
};

const flagQuery = (query, key) => {
    const value = query && query[key];
    if (value === undefined) return false;
    if (value !== 'true' && value !== 'false') throw new GoalRefused(key, 'must be true or false');
    return value === 'true';
};

module.exports = {
    MAX_TARGETS, MAX_NAME, MAX_DESCRIPTION, MAX_UNIT, MAX_SHARED, MAX_WEIGHT, MAX_GOALS_PER_OWNER, TARGET_KINDS, BOOLEAN, CURRENCY,
    GoalRefused, parseGoalBody, parseNewTarget, parseTargetEdit, parseTargetValue, requirePeriodInOrder, flagQuery,
};

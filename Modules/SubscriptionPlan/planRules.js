const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const MAX_NAME_LENGTH = 120;
const MAX_LIST_LENGTH = 200;
const MAX_PLAN_BYTES = 64 * 1024;
const UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype'];

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));

const hasUnsafeKey = (value) => {
    if (Array.isArray(value)) return value.some(hasUnsafeKey);
    if (!isPlainObject(value)) return false;
    return Object.entries(value).some(([key, inner]) => key.startsWith('$') || key.includes('.') || UNSAFE_KEYS.includes(key) || hasUnsafeKey(inner));
};

const isFlag = (value) => typeof value === 'boolean';
const isStatus = (value) => Number.isInteger(value) && value >= 0;
const isList = (value) => Array.isArray(value) && value.length <= MAX_LIST_LENGTH && !hasUnsafeKey(value);

// The stored fields of a plan (utils/mongo-handler/schema.js, subscriptionPlan) and what each accepts.
const FIELD_CHECKS = {
    planName: (value) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= MAX_NAME_LENGTH,
    itemPriceArray: isList,
    addonPriceArray: isList,
    planDetails: (value) => isPlainObject(value) && !hasUnsafeKey(value),
    isDefaultShow: isFlag,
    defaultSubscribe: isFlag,
    status: isStatus,
};

const FILTER_CHECKS = {
    planName: (value) => typeof value === 'string' && value.length <= MAX_NAME_LENGTH,
    status: isStatus,
    isDefaultShow: isFlag,
    defaultSubscribe: isFlag,
};

const PLAN_FIELDS = Object.keys(FIELD_CHECKS);
const PLAN_FILTERS = Object.keys(FILTER_CHECKS);

const refuse = (error) => ({ ok: false, error });
const unknownKeys = (value, allowed) => Object.keys(value).filter((key) => !allowed.includes(key));

const validatePlanUpdate = (body) => {
    if (!isPlainObject(body)) return refuse('A plan update names the plan id and the fields to change.');
    const extra = unknownKeys(body, ['id', 'plan']);
    if (extra.length) return refuse(`Only id and plan are accepted, not ${extra.join(', ')}.`);
    if (typeof body.id !== 'string' || !OBJECT_ID_PATTERN.test(body.id)) return refuse('id must be a plan id.');
    if (!isPlainObject(body.plan)) return refuse('plan must be an object of the fields to change.');
    const names = Object.keys(body.plan);
    if (!names.length) return refuse(`plan must change at least one of ${PLAN_FIELDS.join(', ')}.`);
    const unknown = unknownKeys(body.plan, PLAN_FIELDS);
    if (unknown.length) return refuse(`A plan has no field ${unknown.join(', ')}; the fields are ${PLAN_FIELDS.join(', ')}.`);
    const invalid = names.filter((name) => !FIELD_CHECKS[name](body.plan[name]));
    if (invalid.length) return refuse(`${invalid.join(', ')} has a value a plan cannot store.`);
    if (Buffer.byteLength(JSON.stringify(body.plan)) > MAX_PLAN_BYTES) return refuse('The plan is too large.');
    const fields = { ...body.plan };
    if (fields.planName !== undefined) fields.planName = fields.planName.trim();
    return { ok: true, id: body.id, fields };
};

const validatePlanFilters = (body) => {
    if (body === undefined || body === null) return { ok: true, filters: {} };
    if (!isPlainObject(body)) return refuse('The plan list takes an optional filters object.');
    const extra = unknownKeys(body, ['filters']);
    if (extra.length) return refuse(`Only filters is accepted, not ${extra.join(', ')}.`);
    if (body.filters === undefined) return { ok: true, filters: {} };
    if (!isPlainObject(body.filters)) return refuse('filters must be an object.');
    const unknown = unknownKeys(body.filters, PLAN_FILTERS);
    if (unknown.length) return refuse(`Plans can be filtered by ${PLAN_FILTERS.join(', ')}, not ${unknown.join(', ')}.`);
    const invalid = Object.keys(body.filters).filter((name) => !FILTER_CHECKS[name](body.filters[name]));
    if (invalid.length) return refuse(`${invalid.join(', ')} is not a value plans can be filtered by.`);
    return { ok: true, filters: { ...body.filters } };
};

const matchesFilters = (plan, filters) => Object.entries(filters).every(([name, value]) => plan[name] === value);

module.exports = { OBJECT_ID_PATTERN, PLAN_FIELDS, PLAN_FILTERS, validatePlanUpdate, validatePlanFilters, matchesFilters };

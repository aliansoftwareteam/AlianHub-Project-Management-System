const MAX_LIMIT = 500;
const MAX_STAGES = 20;

const ALLOWED_STAGES = Object.freeze(['$match', '$sort', '$skip', '$limit', '$project', '$count']);

const FORBIDDEN_OPERATORS = Object.freeze([
    '$where', '$function', '$accumulator', '$lookup', '$graphLookup', '$unionWith', '$facet', '$out', '$merge',
]);

class InvoiceQueryRefused extends Error {
    constructor(reason) {
        super(reason);
        this.name = 'InvoiceQueryRefused';
    }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));

const findForbiddenOperator = (value) => {
    if (Array.isArray(value)) {
        for (const item of value) {
            const hit = findForbiddenOperator(item);
            if (hit) return hit;
        }
        return null;
    }
    if (!isPlainObject(value)) return null;
    for (const [key, inner] of Object.entries(value)) {
        if (FORBIDDEN_OPERATORS.includes(key)) return key;
        const hit = findForbiddenOperator(inner);
        if (hit) return hit;
    }
    return null;
};

const checkStage = (stage) => {
    if (!isPlainObject(stage) || Object.keys(stage).length !== 1 || !Object.keys(stage)[0].startsWith('$')) {
        throw new InvoiceQueryRefused('Each stage must be an object with exactly one pipeline operator.');
    }
    const [name, spec] = Object.entries(stage)[0];
    if (!ALLOWED_STAGES.includes(name)) throw new InvoiceQueryRefused(`${name} is not an allowed invoice query stage.`);
    const forbidden = findForbiddenOperator(spec);
    if (forbidden) throw new InvoiceQueryRefused(`${forbidden} is not allowed inside ${name}.`);
    if (name === '$limit') {
        const n = Number(spec);
        if (!Number.isInteger(n) || n < 1) throw new InvoiceQueryRefused('$limit must be a positive integer.');
        return { $limit: Math.min(n, MAX_LIMIT) };
    }
    if (name === '$skip') {
        const n = Number(spec);
        if (!Number.isInteger(n) || n < 0) throw new InvoiceQueryRefused('$skip must be a non-negative integer.');
        return { $skip: n };
    }
    return stage;
};

/* Callers send either a lone stage object or an array of stages. */
const validateInvoicePipeline = (findQuery) => {
    const stages = isPlainObject(findQuery) ? [findQuery] : findQuery;
    if (!Array.isArray(stages)) throw new InvoiceQueryRefused('findQuery must be an aggregation pipeline.');
    if (!stages.length) throw new InvoiceQueryRefused('findQuery must have at least one stage.');
    if (stages.length > MAX_STAGES) throw new InvoiceQueryRefused(`findQuery accepts at most ${MAX_STAGES} stages.`);
    return stages.map(checkStage);
};

module.exports = { MAX_LIMIT, ALLOWED_STAGES, FORBIDDEN_OPERATORS, InvoiceQueryRefused, validateInvoicePipeline };

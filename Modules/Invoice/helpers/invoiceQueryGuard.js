const { FORBIDDEN_OPERATORS: CALLER_FORBIDDEN_OPERATORS, TOO_DEEP, NESTED_TOO_DEEPLY, isPlainObject, forbiddenOperatorIn, withPlainSearchText, SearchTextRefused } = require('../../Company/helpers/callerQueryRules');

const MAX_LIMIT = 500;
const MAX_STAGES = 20;

const ALLOWED_STAGES = Object.freeze(['$match', '$sort', '$skip', '$limit', '$project', '$count']);

/* The one list every caller-built query is held to, and $facet, which an invoice query has no use for. */
const FORBIDDEN_OPERATORS = Object.freeze([...CALLER_FORBIDDEN_OPERATORS, '$facet']);

class InvoiceQueryRefused extends Error {
    constructor(reason) {
        super(reason);
        this.name = 'InvoiceQueryRefused';
    }
}

const checkStage = (stage) => {
    if (!isPlainObject(stage) || Object.keys(stage).length !== 1 || !Object.keys(stage)[0].startsWith('$')) {
        throw new InvoiceQueryRefused('Each stage must be an object with exactly one pipeline operator.');
    }
    const [name, spec] = Object.entries(stage)[0];
    if (!ALLOWED_STAGES.includes(name)) throw new InvoiceQueryRefused(`${name} is not an allowed invoice query stage.`);
    const forbidden = forbiddenOperatorIn(spec, FORBIDDEN_OPERATORS);
    if (forbidden === TOO_DEEP) throw new InvoiceQueryRefused(NESTED_TOO_DEEPLY);
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
    try {
        return { [name]: withPlainSearchText(spec) };
    } catch (error) {
        if (error instanceof SearchTextRefused) throw new InvoiceQueryRefused(error.message);
        throw error;
    }
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

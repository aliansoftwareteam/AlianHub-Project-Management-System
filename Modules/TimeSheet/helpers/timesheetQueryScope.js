const { scopedTimeMatch } = require('./timeScope');

const REFUSED_OPERATORS = Object.freeze(['$out', '$merge', '$unionWith', '$graphLookup', '$function', '$accumulator', '$where']);
const JOINABLE_COLLECTION = 'tasks';

class TimesheetQueryRefused extends Error {
    constructor(reason) {
        super(reason);
        this.name = 'TimesheetQueryRefused';
    }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/* A $lookup reads another collection, so the $match put in front of the pipeline does
 * not cover it: a non-admin may only join tasks, limited to the projects they can open. */
const scopeLookup = (spec, scope) => {
    if (scope.companyWide) return walk(spec, scope);
    if (!isPlainObject(spec) || spec.from !== JOINABLE_COLLECTION || !Array.isArray(spec.pipeline)) {
        throw new TimesheetQueryRefused('A timesheet query can only join tasks, through a pipeline.');
    }
    const { pipeline, ...rest } = spec;
    return { ...walk(rest, scope), pipeline: [{ $match: { ProjectID: { $in: scope.visible } } }, ...walk(pipeline, scope)] };
};

const walk = (value, scope) => {
    if (Array.isArray(value)) return value.map((item) => walk(item, scope));
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => {
        if (REFUSED_OPERATORS.includes(key)) throw new TimesheetQueryRefused(`${key} is not allowed in a timesheet query.`);
        return [key, key === '$lookup' ? scopeLookup(inner, scope) : walk(inner, scope)];
    }));
};

const scopeTimesheetPipeline = (query, scope) => {
    const stages = isPlainObject(query) ? [query] : query;
    if (!Array.isArray(stages) || !stages.length) throw new TimesheetQueryRefused('queryeta must be an aggregation pipeline.');
    const checked = walk(stages, scope);
    return scope.companyWide ? checked : [{ $match: scopedTimeMatch(scope) }, ...checked];
};

module.exports = { REFUSED_OPERATORS, TimesheetQueryRefused, scopeTimesheetPipeline };

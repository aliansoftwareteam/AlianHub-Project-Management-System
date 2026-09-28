const { scopedTimeMatch, scopedEstimateMatch } = require('./timeScope');
const { toObjectIds } = require('../../Tasks/helpers/taskQueryGuard');
const { idForms } = require('../../../utils/mongo-handler/objectIdKeys');

const REFUSED_OPERATORS = Object.freeze(['$out', '$merge', '$unionWith', '$graphLookup', '$function', '$accumulator', '$where']);

const PROJECT_FIELD_OF_JOINABLE = Object.freeze({ tasks: 'ProjectID' });
const PROJECT_FIELD_OF_JOINABLE_INSIDE_TASKS = Object.freeze({ ...PROJECT_FIELD_OF_JOINABLE, folders: 'projectId', sprints: 'projectId' });

class TimesheetQueryRefused extends Error {
    constructor(reason) {
        super(reason);
        this.name = 'TimesheetQueryRefused';
    }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/* Tasks, folders and sprints store the project as an ObjectId, and an aggregate never casts. */
const inVisibleProjects = (field, scope) => ({ $match: { [field]: { $in: [...toObjectIds(scope.visible), ...scope.visible] } } });

/* A $lookup reads another collection, so the $match put in front of the pipeline does
 * not cover it: a non-admin may join tasks, and from inside that join the folders and
 * sprints they sit in, each limited to the projects the caller can open. */
const scopeLookup = (spec, scope, joinable) => {
    if (scope.companyWide) return walk(spec, scope, joinable);
    const from = isPlainObject(spec) ? spec.from : undefined;
    const projectField = typeof from === 'string' && Object.prototype.hasOwnProperty.call(joinable, from) ? joinable[from] : null;
    if (!projectField || !Array.isArray(spec.pipeline)) {
        throw new TimesheetQueryRefused('A timesheet query can only join tasks, and the folders and sprints of those tasks, through a pipeline.');
    }
    const { pipeline, ...rest } = spec;
    return {
        ...walk(rest, scope, joinable),
        pipeline: [inVisibleProjects(projectField, scope), ...walk(pipeline, scope, PROJECT_FIELD_OF_JOINABLE_INSIDE_TASKS)],
    };
};

const LOGICAL_OPERATORS = Object.freeze(['$and', '$or', '$nor']);

const projectIdInBothForms = (condition) => {
    if (typeof condition === 'string') return { $in: idForms(condition) };
    if (!isPlainObject(condition)) return condition;
    return Object.fromEntries(Object.entries(condition).map(([op, value]) => {
        if (['$in', '$nin'].includes(op) && Array.isArray(value)) return [op, idForms(value)];
        if (op === '$eq' && typeof value === 'string') return ['$in', idForms(value)];
        if (op === '$ne' && typeof value === 'string') return ['$nin', idForms(value)];
        return [op, value];
    }));
};

/* The screens send project ids as text, and a time row holds its project id as text or, from
 * task 040 on, as an ObjectId; an aggregate casts neither, so the $match names both forms. */
const matchBothProjectIdForms = (match) => {
    if (!isPlainObject(match)) return match;
    return Object.fromEntries(Object.entries(match).map(([key, value]) => {
        if (LOGICAL_OPERATORS.includes(key) && Array.isArray(value)) return [key, value.map(matchBothProjectIdForms)];
        return [key, key === 'ProjectId' ? projectIdInBothForms(value) : value];
    }));
};

const walk = (value, scope, joinable = PROJECT_FIELD_OF_JOINABLE) => {
    if (Array.isArray(value)) return value.map((item) => walk(item, scope, joinable));
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => {
        if (REFUSED_OPERATORS.includes(key)) throw new TimesheetQueryRefused(`${key} is not allowed in a timesheet query.`);
        if (key === '$lookup') return [key, scopeLookup(inner, scope, joinable)];
        return [key, walk(key === '$match' ? matchBothProjectIdForms(inner) : inner, scope, joinable)];
    }));
};

const checkStages = (stages, scope) => walk(stages, scope);

const scopePipeline = (query, scope, ownRowsMatch) => {
    const stages = isPlainObject(query) ? [query] : query;
    if (!Array.isArray(stages) || !stages.length) throw new TimesheetQueryRefused('queryeta must be an aggregation pipeline.');
    const checked = walk(stages, scope);
    return scope.companyWide ? checked : [{ $match: ownRowsMatch(scope) }, ...checked];
};

const scopeTimesheetPipeline = (query, scope) => scopePipeline(query, scope, scopedTimeMatch);
const scopeEstimatePipeline = (query, scope) => scopePipeline(query, scope, scopedEstimateMatch);

module.exports = {
    REFUSED_OPERATORS,
    TimesheetQueryRefused,
    isPlainObject,
    checkStages,
    scopeTimesheetPipeline,
    scopeEstimatePipeline,
};

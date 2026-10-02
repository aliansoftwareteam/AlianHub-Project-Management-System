const { scopedTimeMatch, scopedEstimateMatch } = require('./timeScope');
const { toObjectIds, companyWideMatch } = require('../../Tasks/helpers/taskQueryGuard');
const { idForms } = require('../../../utils/mongo-handler/objectIdKeys');
const { dbCollections } = require('../../../Config/collections');
const { privateWorkOf, commentClause } = require('../../Agents/privateWork');
const { withoutConversationsOfOthers } = require('../../Comments/helpers/conversationReaders');

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

/* Tasks, folders and sprints store the project as an ObjectId, and an aggregate never casts. A join into tasks
 * also leaves out a conversation the caller is not in, which is stored among them. */
const inVisibleProjects = (from, field, scope) => ({
    $match: { [field]: { $in: [...toObjectIds(scope.visible), ...scope.visible] }, ...(from === dbCollections.TASKS ? withoutConversationsOfOthers(scope.uid) : {}) },
});

/* What a company-wide caller's join leaves out of the two collections that hold private work: someone
 * else's personal list, and a chat the caller is not in. */
const PRIVATE_WORK_IN = Object.freeze({
    [dbCollections.TASKS]: (privateWork) => companyWideMatch(privateWork.uid, privateWork.personalLists),
    [dbCollections.COMMENTS]: (privateWork) => commentClause(privateWork),
});

/* An owner or admin may join any collection. A join into tasks or comments starts with the exclusion a
 * direct read of them gets; one it cannot be put in front of is refused rather than let through. */
const companyWideLookup = (spec, scope, joinable) => {
    if (!isPlainObject(spec) || typeof spec.from !== 'string') {
        throw new TimesheetQueryRefused('A join in a timesheet query names its collection as text.');
    }
    const exclusion = Object.prototype.hasOwnProperty.call(PRIVATE_WORK_IN, spec.from) ? PRIVATE_WORK_IN[spec.from] : null;
    if (!exclusion) return walk(spec, scope, joinable);
    if (spec.pipeline !== undefined && !Array.isArray(spec.pipeline)) {
        throw new TimesheetQueryRefused(`A join into ${spec.from} takes its pipeline as a list of stages.`);
    }
    if (!scope.privateWork) throw new TimesheetQueryRefused(`A join into ${spec.from} cannot be scoped for this request.`);
    const { pipeline = [], ...rest } = spec;
    const leading = exclusion(scope.privateWork);
    return {
        ...walk(rest, scope, joinable),
        pipeline: [...(Object.keys(leading).length ? [{ $match: leading }] : []), ...walk(pipeline, scope, joinable)],
    };
};

/* A $lookup reads another collection, so the $match put in front of the pipeline does
 * not cover it: a non-admin may join tasks, and from inside that join the folders and
 * sprints they sit in, each limited to the projects the caller can open. */
const scopeLookup = (spec, scope, joinable) => {
    if (scope.companyWide) return companyWideLookup(spec, scope, joinable);
    const from = isPlainObject(spec) ? spec.from : undefined;
    const projectField = typeof from === 'string' && Object.prototype.hasOwnProperty.call(joinable, from) ? joinable[from] : null;
    if (!projectField || !Array.isArray(spec.pipeline)) {
        throw new TimesheetQueryRefused('A timesheet query can only join tasks, and the folders and sprints of those tasks, through a pipeline.');
    }
    const { pipeline, ...rest } = spec;
    return {
        ...walk(rest, scope, joinable),
        pipeline: [inVisibleProjects(from, projectField, scope), ...walk(pipeline, scope, PROJECT_FIELD_OF_JOINABLE_INSIDE_TASKS)],
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
    const own = ownRowsMatch(scope);
    return Object.keys(own).length ? [{ $match: own }, ...checked] : checked;
};

const mentions = (value, key) => (Array.isArray(value)
    ? value.some((item) => mentions(item, key))
    : isPlainObject(value) && Object.entries(value).some(([name, inner]) => name === key || mentions(inner, key)));

const NO_PRIVATE_WORK = Object.freeze({ uid: '', personalLists: [], directSpaces: [], myChats: [] });

/* `build(scope)` turns the request into its pipeline. What a company-wide caller's joins are narrowed
 * with is read only when the query has a join, and only after a first pass has refused what it must,
 * so a refused query reads nothing. */
const withJoinScope = async (companyId, scope, query, build) => {
    if (!scope.companyWide || !mentions(query, '$lookup')) return build(scope);
    build({ ...scope, privateWork: NO_PRIVATE_WORK });
    return build({ ...scope, privateWork: await privateWorkOf(companyId, scope.uid) });
};

const scopeTimesheetPipeline = (query, scope) => scopePipeline(query, scope, scopedTimeMatch);
const scopeEstimatePipeline = (query, scope) => scopePipeline(query, scope, scopedEstimateMatch);

module.exports = {
    REFUSED_OPERATORS,
    TimesheetQueryRefused,
    isPlainObject,
    checkStages,
    withJoinScope,
    scopeTimesheetPipeline,
    scopeEstimatePipeline,
};

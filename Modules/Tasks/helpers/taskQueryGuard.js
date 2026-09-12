const mongoose = require('mongoose');
const { dbCollections } = require('../../../Config/collections');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');
const { visibleProjectIds } = require('../../Agents/scope');
const { hiddenSprintIds } = require('../../Sprints/helpers/sprintVisibility');

const MAX_LIMIT = 1000;
const MAX_STAGES = 40;

const TOP_LEVEL_STAGES = Object.freeze(['$match', '$sort', '$skip', '$limit', '$project', '$addFields', '$count', '$group', '$unwind', '$lookup', '$facet']);
const SUB_PIPELINE_STAGES = Object.freeze(['$match', '$sort', '$skip', '$limit', '$project', '$addFields', '$count', '$group', '$unwind']);

const FORBIDDEN_OPERATORS = Object.freeze([
    '$where', '$function', '$accumulator', '$out', '$merge', '$unionWith', '$graphLookup', '$lookup', '$facet',
    '$documents', '$collStats', '$indexStats', '$currentOp', '$listSessions', '$listLocalSessions', '$planCacheStats',
]);

const LOOKUP_TARGETS = Object.freeze({
    [dbCollections.PROJECTS]: Object.freeze({ localField: Object.freeze(['ProjectID']), foreignField: Object.freeze(['_id']) }),
    [dbCollections.SPRINTS]: Object.freeze({ localField: Object.freeze(['sprintId']), foreignField: Object.freeze(['_id']) }),
    [dbCollections.FOLDERS]: Object.freeze({ localField: Object.freeze(['folderObjId']), foreignField: Object.freeze(['_id']) }),
});

class QueryRefused extends Error {
    constructor(stage, reason) {
        super(`${stage} is not allowed: ${reason}`);
        this.name = 'QueryRefused';
        this.stage = stage;
        this.reason = reason;
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

const clampLimit = (value) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) throw new QueryRefused('$limit', 'it must be a positive integer');
    return Math.min(n, MAX_LIMIT);
};

const checkSkip = (value) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) throw new QueryRefused('$skip', 'it must be a non-negative integer');
    return n;
};

let validateStages;

const checkLookup = (spec) => {
    if (!isPlainObject(spec)) throw new QueryRefused('$lookup', 'the stage must be an object');
    const target = Object.prototype.hasOwnProperty.call(LOOKUP_TARGETS, spec.from) ? LOOKUP_TARGETS[spec.from] : null;
    if (!target) throw new QueryRefused('$lookup', `collection "${spec.from}" cannot be joined`);
    if (spec.let !== undefined) throw new QueryRefused('$lookup', 'let is not supported; join on localField and foreignField');
    if (!target.localField.includes(spec.localField)) throw new QueryRefused('$lookup', `localField "${spec.localField}" cannot join ${spec.from}`);
    if (!target.foreignField.includes(spec.foreignField)) throw new QueryRefused('$lookup', `foreignField "${spec.foreignField}" cannot join ${spec.from}`);
    if (typeof spec.as !== 'string' || !spec.as || spec.as.startsWith('$')) throw new QueryRefused('$lookup', 'as must name a field');
    const extra = Object.keys(spec).filter((k) => !['from', 'localField', 'foreignField', 'as', 'pipeline'].includes(k));
    if (extra.length) throw new QueryRefused('$lookup', `unsupported option ${extra[0]}`);
    const out = { from: spec.from, localField: spec.localField, foreignField: spec.foreignField, as: spec.as };
    if (spec.pipeline !== undefined) out.pipeline = validateStages(spec.pipeline, SUB_PIPELINE_STAGES);
    return out;
};

const checkFacet = (spec) => {
    if (!isPlainObject(spec) || !Object.keys(spec).length) throw new QueryRefused('$facet', 'the stage must name at least one output');
    return Object.fromEntries(Object.entries(spec).map(([output, stages]) => {
        if (output.startsWith('$') || output.includes('.')) throw new QueryRefused('$facet', `output "${output}" is not a field name`);
        return [output, validateStages(stages, SUB_PIPELINE_STAGES)];
    }));
};

validateStages = (stages, allowed) => {
    if (!Array.isArray(stages)) throw new QueryRefused('pipeline', 'a pipeline must be an array of stages');
    if (stages.length > MAX_STAGES) throw new QueryRefused('pipeline', `at most ${MAX_STAGES} stages are accepted`);
    return stages.map((stage) => {
        if (!isPlainObject(stage) || Object.keys(stage).length !== 1) throw new QueryRefused('pipeline', 'each stage must be an object with exactly one operator');
        const [name, spec] = Object.entries(stage)[0];
        if (!allowed.includes(name)) throw new QueryRefused(name, 'the stage is outside the task query allowlist');
        if (name === '$lookup') return { $lookup: checkLookup(spec) };
        if (name === '$facet') return { $facet: checkFacet(spec) };
        const forbidden = findForbiddenOperator(spec);
        if (forbidden) throw new QueryRefused(forbidden, `found inside ${name}`);
        if (name === '$limit') return { $limit: clampLimit(spec) };
        if (name === '$skip') return { $skip: checkSkip(spec) };
        return stage;
    });
};

/* Several callers send a lone { $match } object, which Mongoose's aggregate accepts as a one-stage pipeline. */
const validatePipeline = (pipeline) => validateStages(isPlainObject(pipeline) ? [pipeline] : pipeline, TOP_LEVEL_STAGES);

const toObjectIds = (ids) => (ids || [])
    .filter((id) => /^[a-f0-9]{24}$/i.test(String(id)))
    .map((id) => new mongoose.Types.ObjectId(String(id)));

/* Owners and admins keep company-wide task visibility; everyone else sees the projects the
 * sidebar lists for them, minus the private sprints they are not shared with. */
const visibilityStage = async (companyId, uid) => {
    const roleType = await getRoleType(companyId, uid);
    if (isPrivileged(roleType)) return null;
    const ids = roleType === null ? [] : await visibleProjectIds(companyId, uid);
    const projects = toObjectIds(ids);
    const hidden = await hiddenSprintIds(companyId, uid, projects);
    return { $match: { ProjectID: { $in: projects }, ...(hidden.length ? { sprintId: { $nin: hidden } } : {}) } };
};

module.exports = {
    MAX_LIMIT,
    TOP_LEVEL_STAGES,
    SUB_PIPELINE_STAGES,
    FORBIDDEN_OPERATORS,
    LOOKUP_TARGETS,
    QueryRefused,
    validatePipeline,
    visibilityStage,
    toObjectIds,
};

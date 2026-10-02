const mongoose = require('mongoose');
const { dbCollections } = require('../../../Config/collections');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');
const { visibleProjectIds } = require('../../Agents/scope');
const { hiddenSprintIds } = require('../../Sprints/helpers/sprintVisibility');
const { narrowingFor } = require('../../../Config/tokenNarrowing');
const { idForms } = require('../../../utils/mongo-handler/objectIdKeys');
const { othersPersonalListIds } = require('../../PersonalList/ownership');
const { taskListProjectIds } = require('./taskListProjects');
const { inConversation, conversationsOfOthers, withoutConversationsOfOthers } = require('../../Comments/helpers/conversationReaders');
const { FORBIDDEN_OPERATORS: CALLER_FORBIDDEN_OPERATORS, TOO_DEEP, isPlainObject, forbiddenOperatorIn, withPlainSearchText, SearchTextRefused } = require('../../Company/helpers/callerQueryRules');

const MAX_LIMIT = 1000;
const MAX_STAGES = 40;

const TOP_LEVEL_STAGES = Object.freeze(['$match', '$sort', '$skip', '$limit', '$project', '$addFields', '$count', '$group', '$unwind', '$lookup', '$facet']);
const SUB_PIPELINE_STAGES = Object.freeze(['$match', '$sort', '$skip', '$limit', '$project', '$addFields', '$count', '$group', '$unwind']);

/* The one list every caller-built query is held to, and $facet: a task query takes $lookup and $facet as stages of their own, checked below, never nested. */
const FORBIDDEN_OPERATORS = Object.freeze([...CALLER_FORBIDDEN_OPERATORS, '$facet']);

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

const withPlainText = (name, spec) => {
    try {
        return withPlainSearchText(spec);
    } catch (error) {
        if (error instanceof SearchTextRefused) throw new QueryRefused(name, error.message);
        throw error;
    }
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
        const forbidden = forbiddenOperatorIn(spec, FORBIDDEN_OPERATORS);
        if (forbidden === TOO_DEEP) throw new QueryRefused(name, 'it is nested too deeply');
        if (forbidden) throw new QueryRefused(forbidden, `found inside ${name}`);
        if (name === '$limit') return { $limit: clampLimit(spec) };
        if (name === '$skip') return { $skip: checkSkip(spec) };
        return { [name]: withPlainText(name, spec) };
    });
};

/* Several callers send a lone { $match } object, which Mongoose's aggregate accepts as a one-stage pipeline. */
const validatePipeline = (pipeline) => validateStages(isPlainObject(pipeline) ? [pipeline] : pipeline, TOP_LEVEL_STAGES);

const toObjectIds = (ids) => (ids || [])
    .filter((id) => /^[a-f0-9]{24}$/i.test(String(id)))
    .map((id) => new mongoose.Types.ObjectId(String(id)));

const isId = (value) => typeof value === 'string' || Boolean(value && value._bsontype === 'ObjectId');

const namesList = (value, listId) => {
    const named = isPlainObject(value) && Object.keys(value).length === 1 && '$eq' in value ? value.$eq : value;
    return isId(named) && String(named).toLowerCase() === String(listId);
};

const widened = (clause, listId) => {
    if (!isPlainObject(clause)) return clause;
    const inner = Array.isArray(clause.$and) ? clause.$and.map((part) => widened(part, listId)) : null;
    const changedInside = Boolean(inner) && inner.some((part, at) => part !== clause.$and[at]);
    if (!namesList(clause.sprintId, listId)) return changedInside ? { ...clause, $and: inner } : clause;
    const { sprintId: home, ...rest } = clause;
    const inList = { $or: [{ sprintId: home }, { extraLists: { $elemMatch: { sprintId: listId } } }] };
    return { ...rest, $and: [...(inner || []), inList] };
};

/* The rows of one list are the tasks that live in it and the tasks it holds as an extra list. The
 * caller names the list by its plain `sprintId` in a top-level $match, directly or under $and, and
 * only that is widened: a condition under $or or inside a $facet keeps the meaning it was written
 * with. The scope stage still runs first, on each task's home. */
const withExtraListRows = (stages, sprintId) => {
    const [listId] = toObjectIds([sprintId]);
    if (!listId) return stages;
    return stages.map((stage) => {
        const match = widened(stage.$match, listId);
        return match === stage.$match ? stage : { $match: match };
    });
};

/* The same for one match a server reader built itself, wherever in its pipeline it sits. */
const matchWithExtraListRows = (match, sprintId) => {
    const [listId] = toObjectIds([sprintId]);
    return listId ? widened(match, listId) : match;
};

/* Company-wide, short of what belongs to the people in it: someone else's personal list, and a chat
 * the caller is not in. `personalLists` are the ids othersPersonalListIds gives for the caller. Kept
 * under $nor so a caller that spreads the match into its own filter and then names a ProjectID keeps
 * both exclusions. */
const companyWideMatch = (uid, personalLists) => ({
    $nor: [
        ...(personalLists.length ? [{ ProjectID: { $in: idForms(personalLists) } }] : []),
        conversationsOfOthers(uid),
    ],
});

/* The same rule for a task already read, which must carry ProjectID, mainChat and AssigneeUserId. */
const readsCompanyWide = (task, uid, personalLists) => !personalLists.map(String).includes(String(task.ProjectID))
    && (task.mainChat !== true || inConversation(task, uid));

const companyWideStage = async (companyId, uid) => ({ $match: companyWideMatch(uid, await othersPersonalListIds(companyId, uid)) });

/* Owners and admins keep company-wide task visibility unless a token narrows them to some projects;
 * everyone else sees the projects the sidebar lists for them whose task list their role holds, minus
 * the private sprints they are not shared with. A conversation kept in one of those projects stays
 * with the people in it. */
const visibilityStage = async (companyId, uid) => {
    const roleType = await getRoleType(companyId, uid);
    const privileged = isPrivileged(roleType);
    if (privileged && !narrowingFor(uid)) return companyWideStage(companyId, uid);
    const ids = roleType === null ? [] : await (privileged ? visibleProjectIds : taskListProjectIds)(companyId, uid);
    const projects = toObjectIds(ids);
    const hidden = privileged ? [] : await hiddenSprintIds(companyId, uid, projects);
    return { $match: { ProjectID: { $in: projects }, ...(hidden.length ? { sprintId: { $nin: hidden } } : {}), ...withoutConversationsOfOthers(uid) } };
};

/* A join reads another collection, which the stage put in front of the pipeline does not cover, and the field it
 * joins on is whatever the stages before it left there. So each join starts with what the caller can open of the
 * collection it reads: their projects, and of those the lists they see. */
const joinScope = async (companyId, uid) => {
    const privileged = isPrivileged(await getRoleType(companyId, uid));
    if (privileged && !narrowingFor(uid)) {
        const personal = idForms(await othersPersonalListIds(companyId, uid));
        const outside = (field) => (personal.length ? { [field]: { $nin: personal } } : {});
        return { [dbCollections.PROJECTS]: outside('_id'), [dbCollections.SPRINTS]: outside('projectId'), [dbCollections.FOLDERS]: outside('projectId') };
    }
    const open = await visibleProjectIds(companyId, uid);
    const hidden = privileged ? [] : await hiddenSprintIds(companyId, uid, open);
    return {
        [dbCollections.PROJECTS]: { _id: { $in: idForms(open) } },
        [dbCollections.SPRINTS]: { projectId: { $in: idForms(open) }, ...(hidden.length ? { _id: { $nin: hidden } } : {}) },
        [dbCollections.FOLDERS]: { projectId: { $in: idForms(open) } },
    };
};

const namesJoin = (stages) => stages.some((stage) => isPlainObject(stage) && isPlainObject(stage.$lookup));

/* `stages` as validatePipeline answered them, each join narrowed to what `uid` can open. Nothing is read for a query without one. */
const withScopedJoins = async (companyId, uid, stages) => {
    if (!namesJoin(stages)) return stages;
    const scope = await joinScope(companyId, uid);
    return stages.map((stage) => (isPlainObject(stage.$lookup)
        ? { $lookup: { ...stage.$lookup, pipeline: [{ $match: scope[stage.$lookup.from] }, ...(stage.$lookup.pipeline || [])] } }
        : stage));
};

module.exports = {
    withScopedJoins,
    MAX_LIMIT,
    TOP_LEVEL_STAGES,
    SUB_PIPELINE_STAGES,
    FORBIDDEN_OPERATORS,
    LOOKUP_TARGETS,
    QueryRefused,
    validatePipeline,
    withExtraListRows,
    matchWithExtraListRows,
    visibilityStage,
    companyWideMatch,
    readsCompanyWide,
    toObjectIds,
};

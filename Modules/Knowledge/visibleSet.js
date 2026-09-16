const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { getRoleType } = require('../../Config/permissionGuard');
const { isPrivileged } = require('../../Config/roleTypes');
const { visibleProjectIds } = require('../Agents/scope');
const { hiddenSprintIds } = require('../Sprints/helpers/sprintVisibility');
const { pageVisibilityFilter } = require('../Pages/helpers/pageRules');

// What one caller may retrieve, resolved on every call and never cached here:
// a snapshot kept between calls is exactly how a person removed from a project
// or a sprint keeps reading it. Agents and MCP tokens do not pass the browser
// session check, so the company role is looked up here for every kind of caller.

const SOURCE_TYPES = ['task', 'page', 'comment', 'transcript'];
const CALLER_KINDS = ['user', 'agent', 'mcp'];
const COMMENT_TYPES = ['text', 'link'];
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const SOURCE_COLLECTIONS = {
    task: SCHEMA_TYPE.TASKS,
    page: SCHEMA_TYPE.PAGES,
    comment: SCHEMA_TYPE.COMMENTS,
    transcript: SCHEMA_TYPE.CALLS,
};

class RetrievalRefused extends Error {
    constructor(message) {
        super(message);
        this.name = 'RetrievalRefused';
        this.statusCode = 403;
    }
}

const objectIds = (ids) => ids.filter((id) => OBJECT_ID.test(String(id))).map((id) => new mongoose.Types.ObjectId(String(id)));

const resolveVisibleSet = async ({ companyId, caller, scope } = {}) => {
    const company = String(companyId || '');
    const { kind, userId, agentId = null, runId = null } = caller || {};
    const uid = String(userId || '');
    if (!OBJECT_ID.test(company)) throw new RetrievalRefused('A valid companyId is required.');
    if (!CALLER_KINDS.includes(kind)) throw new RetrievalRefused(`Unknown caller kind: ${kind}.`);
    if (!OBJECT_ID.test(uid)) throw new RetrievalRefused('A caller retrieves as a user of the company.');

    const roleType = await getRoleType(company, uid);
    if (roleType === null || roleType === undefined) throw new RetrievalRefused('The caller holds no role in this company.');
    const privileged = isPrivileged(roleType);

    const visible = (await visibleProjectIds(company, uid)).map(String);
    const projectId = scope && scope.projectId ? String(scope.projectId) : null;
    const projectIds = projectId ? visible.filter((id) => id === projectId) : visible;
    const hidden = privileged || !projectIds.length ? [] : await hiddenSprintIds(company, uid, projectIds);
    const wanted = scope && Array.isArray(scope.sourceTypes) ? scope.sourceTypes : SOURCE_TYPES;

    return {
        companyId: company,
        caller: { kind, userId: uid, agentId, runId },
        roleType,
        privileged,
        projectId,
        projectIds,
        hiddenSprintIds: hidden.map(String),
        sourceTypes: SOURCE_TYPES.filter((type) => wanted.includes(type)),
    };
};

/* Access control as plain match clauses, one per source, that a backend puts beside
 * its own search at the top level of the query: MongoDB refuses $text inside $or. */
const clausesFor = (set) => {
    const projects = objectIds(set.projectIds);
    const sprintClause = set.hiddenSprintIds.length ? { sprintId: { $nin: objectIds(set.hiddenSprintIds) } } : {};
    const pageProject = set.projectId
        ? { ProjectID: { $in: projects } }
        : { $or: [{ ProjectID: { $in: projects } }, { ProjectID: { $in: [null, undefined] } }] };
    return {
        task: { ProjectID: { $in: projects }, deletedStatusKey: { $ne: 1 }, ...sprintClause },
        page: { deletedStatusKey: { $ne: 1 }, $and: [pageProject, pageVisibilityFilter(set.caller.userId)] },
        comment: { projectId: { $in: projects }, isDeleted: { $ne: true }, type: { $in: COMMENT_TYPES }, ...sprintClause },
        transcript: {
            participants: set.caller.userId,
            deletedStatusKey: { $ne: 1 },
            ...(set.projectId ? { projectId: { $in: set.projectIds } } : {}),
        },
    };
};

const filterFor = (set) => ({ sourceTypes: set.sourceTypes, clauses: clausesFor(set) });

const permissionOf = (sourceType, row) => {
    if (sourceType === 'page') {
        if (String(row.visibility || '') === 'private') return { visibility: 'private', via: 'owner' };
        if (!row.ProjectID) return { visibility: 'company', via: 'company' };
        return { visibility: 'project', via: 'project' };
    }
    if (sourceType === 'comment') return { visibility: 'project', via: row.taskId ? 'task' : 'project' };
    if (sourceType === 'transcript') return { visibility: 'participants', via: 'participant' };
    return { visibility: 'project', via: 'project' };
};

const RECHECK_FIELDS = {
    task: '_id',
    page: '_id visibility ProjectID',
    comment: '_id taskId',
    transcript: '_id',
};

/* A comment is visible where its task is: the task must still pass the task clause. */
const onVisibleTasks = async (set, clauses, comments) => {
    const taskIds = [...new Set(comments.map((c) => c.taskId).filter(Boolean).map(String))];
    if (!taskIds.length) return comments;
    const tasks = await MongoDbCrudOpration(set.companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ _id: { $in: objectIds(taskIds) }, ...clauses.task }, '_id'],
    }, 'find');
    const visible = new Set((tasks || []).map((task) => String(task._id)));
    return comments.filter((c) => !c.taskId || visible.has(String(c.taskId)));
};

/* Re-read the ranked candidates from their live source rows and keep only those the
 * caller may still see, whatever index produced them. Order is preserved. */
const recheck = async ({ set, passages }) => {
    const clauses = clausesFor(set);
    const bySource = {};
    passages.forEach((p) => {
        if (!set.sourceTypes.includes(p.sourceType) || !OBJECT_ID.test(String(p.sourceId))) return;
        (bySource[p.sourceType] = bySource[p.sourceType] || []).push(String(p.sourceId));
    });

    const live = {};
    await Promise.all(Object.entries(bySource).map(async ([sourceType, ids]) => {
        let rows = await MongoDbCrudOpration(set.companyId, {
            type: SOURCE_COLLECTIONS[sourceType],
            data: [{ _id: { $in: objectIds(ids) }, ...clauses[sourceType] }, RECHECK_FIELDS[sourceType]],
        }, 'find');
        if (sourceType === 'comment') rows = await onVisibleTasks(set, clauses, rows || []);
        (rows || []).forEach((row) => { live[`${sourceType}:${row._id}`] = permissionOf(sourceType, row); });
    }));

    return passages
        .filter((p) => live[`${p.sourceType}:${p.sourceId}`])
        .map((p) => ({ ...p, permission: live[`${p.sourceType}:${p.sourceId}`] }));
};

module.exports = {
    SOURCE_TYPES,
    CALLER_KINDS,
    SOURCE_COLLECTIONS,
    RetrievalRefused,
    resolveVisibleSet,
    clausesFor,
    filterFor,
    permissionOf,
    recheck,
};

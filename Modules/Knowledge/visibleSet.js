const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const permissionGuard = require('../../Config/permissionGuard');
const { isPrivileged } = require('../../Config/roleTypes');
const { visibleProjectIds } = require('../Agents/scope');
const { hiddenSprintIds } = require('../Sprints/helpers/sprintVisibility');
const { pageVisibilityFilter } = require('../Pages/helpers/pageRules');
const { COMMENT_TYPES, CHUNK_ONLY_SOURCES } = require('./sources');
const { chunkGuide, guideMarkdown, guideTitle } = require('./ingest/chunker');

// What one caller may retrieve, resolved on every call and never cached here:
// a snapshot kept between calls is exactly how a person removed from a project
// or a sprint keeps reading it. Agents and MCP tokens do not pass the browser
// session check, so the company role is looked up here for every kind of caller.

const SOURCE_TYPES = ['task', 'page', 'comment', 'transcript', 'guide', 'file'];
const CALLER_KINDS = ['user', 'agent', 'mcp'];
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const ATTACHMENTS_PERMISSION = 'task.task_attachments';
const TITLE_LENGTH = 160;

const SOURCE_COLLECTIONS = {
    task: SCHEMA_TYPE.TASKS,
    page: SCHEMA_TYPE.PAGES,
    comment: SCHEMA_TYPE.COMMENTS,
    transcript: SCHEMA_TYPE.CALLS,
    guide: SCHEMA_TYPE.PROJECTS,
    file: SCHEMA_TYPE.TASKS,
};

class RetrievalRefused extends Error {
    constructor(message) {
        super(message);
        this.name = 'RetrievalRefused';
        this.statusCode = 403;
    }
}

const objectIds = (ids) => ids.filter((id) => OBJECT_ID.test(String(id))).map((id) => new mongoose.Types.ObjectId(String(id)));

/* A file is read where the web app would show the task's attachments: the same permission, judged
 * per project, since a project can carry its own rules. Rules that cannot be read grant nothing. */
const attachmentProjects = async (companyId, uid, privileged, projectIds) => {
    if (privileged) return projectIds;
    const granted = await Promise.all(projectIds.map(async (projectId) => {
        try {
            return permissionGuard.isReadable(await permissionGuard.evaluatePermission(companyId, uid, ATTACHMENTS_PERMISSION, { projectId }));
        } catch (error) {
            return false;
        }
    }));
    return projectIds.filter((projectId, at) => granted[at]);
};

const resolveVisibleSet = async ({ companyId, caller, scope } = {}) => {
    const company = String(companyId || '');
    const { kind, userId, agentId = null, runId = null } = caller || {};
    const uid = String(userId || '');
    if (!OBJECT_ID.test(company)) throw new RetrievalRefused('A valid companyId is required.');
    if (!CALLER_KINDS.includes(kind)) throw new RetrievalRefused(`Unknown caller kind: ${kind}.`);
    if (!OBJECT_ID.test(uid)) throw new RetrievalRefused('A caller retrieves as a user of the company.');

    const roleType = await permissionGuard.getRoleType(company, uid);
    if (roleType === null || roleType === undefined) throw new RetrievalRefused('The caller holds no role in this company.');
    const privileged = isPrivileged(roleType);

    const visible = (await visibleProjectIds(company, uid)).map(String);
    const projectId = scope && scope.projectId ? String(scope.projectId) : null;
    const projectIds = projectId ? visible.filter((id) => id === projectId) : visible;
    const hidden = privileged || !projectIds.length ? [] : await hiddenSprintIds(company, uid, projectIds);
    const wanted = scope && Array.isArray(scope.sourceTypes) ? scope.sourceTypes : SOURCE_TYPES;
    const fileProjectIds = wanted.includes('file') ? await attachmentProjects(company, uid, privileged, projectIds) : [];

    return {
        companyId: company,
        caller: { kind, userId: uid, agentId, runId },
        roleType,
        privileged,
        projectId,
        projectIds,
        hiddenSprintIds: hidden.map(String),
        fileProjectIds,
        sourceTypes: SOURCE_TYPES.filter((type) => wanted.includes(type)),
    };
};

/* A page with no project is the company's, unless the caller scoped to one project. */
const inProjectOrCompanyWide = (set, field) => {
    const projects = objectIds(set.projectIds);
    return set.projectId
        ? { [field]: { $in: projects } }
        : { $or: [{ [field]: { $in: projects } }, { [field]: { $in: [null, undefined] } }] };
};

/* Access control as plain match clauses, one per source, that a backend puts beside
 * its own search at the top level of the query: MongoDB refuses $text inside $or. */
const clausesFor = (set) => {
    const projects = objectIds(set.projectIds);
    const sprintClause = set.hiddenSprintIds.length ? { sprintId: { $nin: objectIds(set.hiddenSprintIds) } } : {};
    const task = { ProjectID: { $in: projects }, deletedStatusKey: { $ne: 1 }, ...sprintClause };
    return {
        task,
        guide: { deletedStatusKey: { $ne: 1 } },
        file: { ...task, ProjectID: { $in: objectIds(set.fileProjectIds || []) } },
        page: { deletedStatusKey: { $ne: 1 }, $and: [inProjectOrCompanyWide(set, 'ProjectID'), pageVisibilityFilter(set.caller.userId)] },
        comment: { projectId: { $in: projects }, isDeleted: { $ne: true }, type: { $in: COMMENT_TYPES }, ...sprintClause },
        transcript: {
            participants: set.caller.userId,
            deletedStatusKey: { $ne: 1 },
            ...(set.projectId ? { projectId: { $in: set.projectIds } } : {}),
        },
    };
};

const liveChunk = (set, sourceType) => ({ companyId: set.companyId, sourceType, deleted: { $ne: true } });

/* The same rules over the fields a chunk copies from its source. They narrow the search;
 * recheck() against the live rows is still what decides. */
const chunkClausesFor = (set) => {
    const hidden = set.hiddenSprintIds.length ? { sprintId: { $nin: objectIds(set.hiddenSprintIds) } } : {};
    return {
        page: { ...liveChunk(set, 'page'), $and: [inProjectOrCompanyWide(set, 'projectId'), pageVisibilityFilter(set.caller.userId)] },
        comment: { ...liveChunk(set, 'comment'), projectId: { $in: objectIds(set.projectIds) }, ...hidden },
        guide: { ...liveChunk(set, 'guide'), projectId: { $in: objectIds(set.projectIds) } },
        file: { ...liveChunk(set, 'file'), projectId: { $in: objectIds(set.fileProjectIds || []) }, ...hidden },
        transcript: {
            ...liveChunk(set, 'transcript'),
            participants: set.caller.userId,
            ...(set.projectId ? { projectId: { $in: objectIds(set.projectIds) } } : {}),
        },
    };
};

/* chunkSources names the sources whose chunk store is built for this company; the rest are
 * searched from their rows. */
const filterFor = (set, { chunkSources = [] } = {}) => {
    const clauses = clausesFor(set);
    const chunked = chunkClausesFor(set);
    const fromChunks = Object.keys(chunked).filter((sourceType) => chunkSources.includes(sourceType));
    fromChunks.forEach((sourceType) => { clauses[sourceType] = chunked[sourceType]; });
    const sourceTypes = set.sourceTypes.filter((sourceType) => !CHUNK_ONLY_SOURCES.includes(sourceType) || fromChunks.includes(sourceType));
    return { sourceTypes, clauses, chunkSources: fromChunks };
};

const permissionOf = (sourceType, row) => {
    if (sourceType === 'page') {
        if (String(row.visibility || '') === 'private') return { visibility: 'private', via: 'owner' };
        if (!row.ProjectID) return { visibility: 'company', via: 'company' };
        return { visibility: 'project', via: 'project' };
    }
    if (sourceType === 'comment') return { visibility: 'project', via: row.taskId ? 'task' : 'project' };
    if (sourceType === 'transcript') return { visibility: 'participants', via: 'participant' };
    if (sourceType === 'file') return { visibility: 'project', via: 'task' };
    return { visibility: 'project', via: 'project' };
};

const time = (value) => (value ? new Date(value).getTime() || 0 : 0);

const commentTitle = (row) => String(row.message || '').replace(/\s+/g, ' ').trim();

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

const editedSince = (row, p) => time(row.updatedAt) > time(p.updatedAt);

/* How each source is re-read. `rowId` names the live row a passage stands on, `keep` decides from
 * that row whether the passage still exists, and `stale` whether its excerpt may quote text the
 * source no longer says. A file is one attachment of its task: it exists while the attachment is
 * on the task, and its text never changes. A guide is one field of its project, so its project's
 * other edits do not make it stale; a passage from a guide chunk whose text the guide no longer
 * chunks into is. */
const RECHECK = {
    task: { fields: '_id' },
    page: { fields: '_id visibility ProjectID title updatedAt', title: (row) => row.title, stale: editedSince },
    comment: { fields: '_id taskId message updatedAt', title: commentTitle, stale: editedSince, narrow: onVisibleTasks },
    transcript: { fields: '_id title updatedAt', title: (row) => row.title || 'Call notes', stale: editedSince },
    guide: {
        fields: '_id ProjectName aiGuide updatedAt',
        visible: (set, projectId) => set.projectIds.map(String).includes(projectId),
        keep: (row) => Boolean(guideMarkdown(row).trim()),
        title: guideTitle,
        stale: (row, p) => (p.contentHash ? !chunkGuide(row).some((piece) => piece.contentHash === p.contentHash) : editedSince(row, p)),
    },
    file: {
        fields: '_id attachments.id',
        rowId: (p) => String(p.sourceId).split(':')[0],
        keep: (row, p) => (Array.isArray(row.attachments) ? row.attachments : []).some((item) => item && `${row._id}:${item.id}` === String(p.sourceId)),
    },
};

const rowIdOf = (p) => (RECHECK[p.sourceType].rowId ? RECHECK[p.sourceType].rowId(p) : String(p.sourceId));

/* Re-read the ranked candidates from their live source rows and keep only those the
 * caller may still see, whatever index produced them. Order is preserved. A source edited after
 * the text a passage came from keeps its place but shows its live title and no excerpt, since the
 * old excerpt may quote what the edit removed; onStale hears about it. */
const recheck = async ({ set, passages, onStale }) => {
    const clauses = clausesFor(set);
    const bySource = {};
    passages.forEach((p) => {
        const spec = RECHECK[p.sourceType];
        if (!set.sourceTypes.includes(p.sourceType) || !spec || !OBJECT_ID.test(rowIdOf(p))) return;
        if (spec.visible && !spec.visible(set, rowIdOf(p))) return;
        (bySource[p.sourceType] = bySource[p.sourceType] || new Set()).add(rowIdOf(p));
    });

    const live = {};
    await Promise.all(Object.entries(bySource).map(async ([sourceType, ids]) => {
        const spec = RECHECK[sourceType];
        let rows = await MongoDbCrudOpration(set.companyId, {
            type: SOURCE_COLLECTIONS[sourceType],
            data: [{ _id: { $in: objectIds([...ids]) }, ...clauses[sourceType] }, spec.fields],
        }, 'find');
        if (spec.narrow) rows = await spec.narrow(set, clauses, rows || []);
        (rows || []).forEach((row) => { live[`${sourceType}:${row._id}`] = row; });
    }));

    return passages
        .map((p) => ({ p, row: RECHECK[p.sourceType] && live[`${p.sourceType}:${rowIdOf(p)}`] }))
        .filter(({ p, row }) => row && (!RECHECK[p.sourceType].keep || RECHECK[p.sourceType].keep(row, p)))
        .map(({ p, row }) => {
            const spec = RECHECK[p.sourceType];
            const permission = permissionOf(p.sourceType, row);
            if (!spec.stale || !spec.stale(row, p)) return { ...p, permission };
            if (onStale) onStale(p);
            return { ...p, title: String(spec.title(row) || '').slice(0, TITLE_LENGTH), excerpt: '', updatedAt: row.updatedAt, permission };
        });
};

module.exports = {
    SOURCE_TYPES,
    CALLER_KINDS,
    SOURCE_COLLECTIONS,
    RetrievalRefused,
    resolveVisibleSet,
    clausesFor,
    chunkClausesFor,
    filterFor,
    permissionOf,
    recheck,
};

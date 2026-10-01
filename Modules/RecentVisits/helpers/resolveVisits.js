const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { pageReachFilter } = require('../../Pages/helpers/pageRules');

const VISIT_TYPES = ['task', 'project', 'sprint', 'doc'];
const LIST_LIMIT = 15;
const NOT_DELETED = { deletedStatusKey: { $ne: 1 } };
const TASK_FIELDS = 'TaskName TaskKey status statusType ProjectID sprintId folderObjId deletedStatusKey sprintArray updatedAt';

const text = (value) => (value === undefined || value === null ? '' : String(value));

const asObjectIds = (ids) => [...new Set(ids.map(String))]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

const read = (companyId, type, filter, fields, options) => MongoDbCrudOpration(companyId, { type, data: [filter, fields, options] }, 'find')
    .then((rows) => rows || []);

/* Tasks alone unless `types` asks for more, because older callers read `task` off every row. */
const parseListQuery = (query = {}) => {
    const asked = String(query.types || '').split(',').map((type) => type.trim()).filter(Boolean);
    const types = asked.includes('all') ? VISIT_TYPES : [...new Set(asked.filter((type) => VISIT_TYPES.includes(type)))];
    const limit = parseInt(query.limit, 10);
    return {
        types: types.length ? types : ['task'],
        limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, LIST_LIMIT) : LIST_LIMIT,
    };
};

/* The project's first sprint the caller can see, which is where the sidebar lands too. */
const landingSprints = async (companyId, projectIds, hidden) => {
    if (!projectIds.length) return new Map();
    const sprints = await read(companyId, SCHEMA_TYPE.SPRINTS, {
        projectId: { $in: projectIds },
        deletedStatusKey: 0,
        ...(hidden.length ? { _id: { $nin: hidden } } : {}),
    }, 'projectId folderId', { sort: { _id: 1 } });
    const first = new Map();
    sprints.forEach((sprint) => {
        if (!first.has(String(sprint.projectId))) first.set(String(sprint.projectId), sprint);
    });
    return first;
};

/* Every lookup is bounded by the projects the caller can open today and the sprints they are on,
 * so a visit to anything else resolves to nothing and drops out of the list. */
const resolveVisits = async (companyId, uid, visits, { visible, sprintClause = {} }) => {
    const idsOf = (type) => asObjectIds(visits.filter((visit) => visit.entityType === type).map((visit) => visit.entityId));
    const visibleSet = new Set(visible.map(String));
    const inProjects = asObjectIds(visible);
    const hidden = (sprintClause.sprintId && sprintClause.sprintId.$nin) || [];
    const hiddenSet = new Set(hidden.map(String));
    const visitedProjects = idsOf('project').filter((id) => visibleSet.has(String(id)));

    const [tasks, sprints, docs, landing] = await Promise.all([
        idsOf('task').length
            ? read(companyId, SCHEMA_TYPE.TASKS, { _id: { $in: idsOf('task') }, ProjectID: { $in: inProjects }, deletedStatusKey: { $ne: 1 }, ...sprintClause }, TASK_FIELDS)
            : [],
        idsOf('sprint').length
            ? read(companyId, SCHEMA_TYPE.SPRINTS, { _id: { $in: idsOf('sprint') }, projectId: { $in: inProjects }, ...NOT_DELETED }, 'name projectId folderId')
            : [],
        idsOf('doc').length
            ? read(companyId, SCHEMA_TYPE.PAGES, {
                _id: { $in: idsOf('doc') },
                ...NOT_DELETED,
                ...pageReachFilter({ uid, projectIds: inProjects }),
            }, 'title ProjectID')
            : [],
        landingSprints(companyId, visitedProjects, hidden),
    ]);
    const openSprints = sprints.filter((sprint) => !hiddenSet.has(String(sprint._id)));

    const projectIds = [
        ...visitedProjects,
        ...tasks.map((task) => task.ProjectID),
        ...openSprints.map((sprint) => sprint.projectId),
        ...docs.map((doc) => doc.ProjectID).filter(Boolean),
    ].filter((id) => visibleSet.has(String(id)));
    const projects = projectIds.length
        ? await read(companyId, SCHEMA_TYPE.PROJECTS, { _id: { $in: asObjectIds(projectIds) }, ...NOT_DELETED }, 'ProjectName')
        : [];
    const projectName = new Map(projects.map((project) => [String(project._id), project.ProjectName || '']));

    const found = new Map();
    const put = (type, id, projectId, item) => found.set(`${type}:${id}`, {
        type,
        id: String(id),
        projectId: text(projectId),
        projectName: projectName.get(text(projectId)) || '',
        ...item,
    });
    tasks.forEach((task) => put('task', task._id, task.ProjectID, {
        title: task.TaskName || '',
        route: { projectId: text(task.ProjectID), sprintId: text(task.sprintId), folderId: text(task.folderObjId), taskId: String(task._id) },
        task,
    }));
    projects.filter((project) => visitedProjects.some((id) => String(id) === String(project._id))).forEach((project) => {
        const sprint = landing.get(String(project._id));
        put('project', project._id, project._id, {
            title: project.ProjectName || '',
            route: { projectId: String(project._id), sprintId: sprint ? String(sprint._id) : '', folderId: sprint ? text(sprint.folderId) : '' },
        });
    });
    openSprints.forEach((sprint) => put('sprint', sprint._id, sprint.projectId, {
        title: sprint.name || '',
        route: { projectId: text(sprint.projectId), sprintId: String(sprint._id), folderId: text(sprint.folderId) },
    }));
    docs.forEach((doc) => put('doc', doc._id, doc.ProjectID, {
        title: doc.title || '',
        route: { pageId: String(doc._id), projectId: text(doc.ProjectID) },
    }));

    return visits
        .map((visit) => {
            const item = found.get(`${visit.entityType}:${String(visit.entityId)}`);
            return item ? { visitedAt: visit.visitedAt, ...item } : null;
        })
        .filter(Boolean);
};

module.exports = { VISIT_TYPES, LIST_LIMIT, parseListQuery, resolveVisits };

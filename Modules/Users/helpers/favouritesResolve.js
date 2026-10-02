const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');
const { visibleProjects } = require('../../Agents/scope');
const { asObjectIds, canSeeSprint, hiddenSprintIds, sprintIdentities } = require('../../Sprints/helpers/sprintVisibility');
const { pageReachFilter } = require('../../Pages/helpers/pageRules');
const { favouriteKey } = require('./favouritesRules');
const { withoutConversationsOfOthers } = require('../../Comments/helpers/conversationReaders');

const text = (value) => (value === undefined || value === null || value === '' ? undefined : String(value));
const NOT_DELETED = { deletedStatusKey: { $ne: 1 } };

const read = (companyId, type, filter, fields) => MongoDbCrudOpration(companyId, { type, data: [filter, fields] }, 'find')
    .then((rows) => rows || []);

/* Every lookup is bounded by the projects the caller can open today, so an entry for anything
 * else resolves to nothing and leaves the list without a name, a count or a hint that it exists. */
const resolveFavourites = async (companyId, uid, entries) => {
    if (!entries.length) return [];
    const idsOf = (type) => asObjectIds(entries.filter((entry) => entry.type === type).map((entry) => entry.id));
    const projects = await visibleProjects(companyId, uid);
    const projectIds = projects.map((project) => String(project._id));
    const inProjects = asObjectIds(projectIds);
    const privileged = isPrivileged(await getRoleType(String(companyId), String(uid)));

    const [folders, sprints, hiddenSprints, tasks, docs, identities] = await Promise.all([
        read(companyId, SCHEMA_TYPE.FOLDERS, { _id: { $in: idsOf('folder') }, projectId: { $in: inProjects }, ...NOT_DELETED }, 'name projectId'),
        read(companyId, SCHEMA_TYPE.SPRINTS, { _id: { $in: idsOf('sprint') }, projectId: { $in: inProjects }, ...NOT_DELETED }, 'name projectId folderId private AssigneeUserId'),
        privileged ? [] : hiddenSprintIds(companyId, uid, projectIds),
        read(companyId, SCHEMA_TYPE.TASKS, { _id: { $in: idsOf('task') }, ProjectID: { $in: inProjects }, ...NOT_DELETED, ...withoutConversationsOfOthers(uid) }, 'TaskName TaskKey ProjectID sprintId folderObjId'),
        read(companyId, SCHEMA_TYPE.PAGES, {
            _id: { $in: idsOf('doc') },
            ...NOT_DELETED,
            ...pageReachFilter({ uid, projectIds: inProjects }),
        }, 'title ProjectID'),
        privileged ? [] : sprintIdentities(companyId, uid),
    ]);
    const hidden = new Set(hiddenSprints.map(String));

    const found = new Map();
    const put = (type, id, item) => found.set(favouriteKey({ type, id: String(id) }), { type, id: String(id), ...item });
    projects.forEach((project) => put('project', project._id, { name: project.ProjectName, projectId: String(project._id) }));
    folders.forEach((folder) => put('folder', folder._id, { name: folder.name, projectId: text(folder.projectId) }));
    sprints
        .filter((sprint) => privileged || canSeeSprint(sprint, identities))
        .forEach((sprint) => put('sprint', sprint._id, { name: sprint.name, projectId: text(sprint.projectId), folderId: text(sprint.folderId) }));
    tasks
        .filter((task) => !hidden.has(String(task.sprintId)))
        .forEach((task) => put('task', task._id, { name: task.TaskName, key: task.TaskKey, projectId: text(task.ProjectID), sprintId: text(task.sprintId), folderId: text(task.folderObjId) }));
    docs.forEach((doc) => put('doc', doc._id, { name: doc.title, projectId: text(doc.ProjectID) }));

    return entries
        .map((entry) => found.get(favouriteKey(entry)))
        .filter(Boolean)
        .map((item) => JSON.parse(JSON.stringify(item)));
};

const asUserId = (uid) => new mongoose.Types.ObjectId(String(uid));

module.exports = { resolveFavourites, asUserId };

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { canEditProject, canReadProject, DETAILS } = require('../../../Config/projectAccess');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');
const { canSeeSprint, sprintIdentities } = require('../../Sprints/helpers/sprintVisibility');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const CREATE_TASKS = ['task.task_create'];
const NOT_FOUND = { allowed: false, statusCode: 404 };

const findById = (companyId, type, id, fields) => MongoDbCrudOpration(companyId, {
    type,
    data: [{ _id: new mongoose.Types.ObjectId(String(id)) }, fields],
}, 'findOne');

/* The sprint and its folder come from the stored rows, so an import cannot pair a project the
 * caller may write to with another project's sprint, or land in a private sprint they are not on.
 * Adding the file's missing statuses changes the project's status list, which needs project details. */
const importTargetAccess = async (companyId, uid, { projectId, sprintId, addsStatuses = false }) => {
    if (!OBJECT_ID.test(String(projectId || '')) || !OBJECT_ID.test(String(sprintId || ''))) return NOT_FOUND;
    const project = await canEditProject(companyId, uid, projectId, addsStatuses ? [...CREATE_TASKS, DETAILS] : CREATE_TASKS);
    if (!project.allowed) return project;

    const sprint = await findById(companyId, SCHEMA_TYPE.SPRINTS, sprintId, { name: 1, projectId: 1, folderId: 1, private: 1, AssigneeUserId: 1 });
    if (!sprint || String(sprint.projectId) !== String(projectId)) return NOT_FOUND;
    if (!isPrivileged(await getRoleType(companyId, uid)) && !canSeeSprint(sprint, await sprintIdentities(companyId, uid))) return NOT_FOUND;

    const folder = OBJECT_ID.test(String(sprint.folderId || '')) ? await findById(companyId, SCHEMA_TYPE.FOLDERS, sprint.folderId, { name: 1 }) : null;
    return {
        allowed: true,
        sprint: { id: String(sprint._id), name: sprint.name || '', ...(folder ? { folderId: String(folder._id), folderName: folder.name || '' } : {}) },
    };
};

const previewAccess = (companyId, uid, projectId) => canReadProject(companyId, uid, projectId);

const refuseImport = (res, decision) => (decision.statusCode === 403
    ? res.status(403).send({ status: false, statusText: 'You do not have permission to import tasks into this project.' })
    : res.status(404).send({ status: false, statusText: 'Project or sprint not found.' }));

module.exports = { importTargetAccess, previewAccess, refuseImport };

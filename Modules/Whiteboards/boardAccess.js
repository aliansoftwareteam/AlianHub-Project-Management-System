const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { projectAccess } = require('../../Config/contentAccess');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { canSeeSprint, sprintIdentities } = require('../Sprints/helpers/sprintVisibility');
const { OBJECT_ID } = require('./boardRules');

const NONE = Object.freeze({ visible: false, canEdit: false });
const DELETED = 1;
const GONE = 'gone';
const FROZEN = 'frozen';
const LIVE = 'live';

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const findOne = (companyId, type, filter, fields) => MongoDbCrudOpration(companyId, { type, data: [filter, fields] }, 'findOne');

const listOf = async (companyId, projectId, sprintId) => {
    const sprint = await findOne(companyId, SCHEMA_TYPE.SPRINTS, { _id: oid(sprintId) }, { projectId: 1, folderId: 1, private: 1, AssigneeUserId: 1, deletedStatusKey: 1 });
    return sprint && String(sprint.projectId) === String(projectId) ? sprint : null;
};

/* The folder a list sits in and that folder's parent; folders nest one level. */
const foldersAbove = async (companyId, sprint) => {
    if (!sprint.folderId || !OBJECT_ID.test(String(sprint.folderId))) return [];
    const folder = await findOne(companyId, SCHEMA_TYPE.FOLDERS, { _id: oid(sprint.folderId) }, { deletedStatusKey: 1, parentFolderId: 1 });
    if (!folder) return [];
    const parent = folder.parentFolderId
        ? await findOne(companyId, SCHEMA_TYPE.FOLDERS, { _id: oid(folder.parentFolderId) }, { deletedStatusKey: 1 })
        : null;
    return [folder, parent].filter(Boolean);
};

/*
 * A board has no state of its own to fall out of step: it is as open as its list is at the moment it is asked
 * for. While the list, a folder above it or the project is in the trash the board is gone; while any of them is
 * archived or closed it can be read and not changed; once they are restored it is back exactly as it was left.
 * The folder and project cascades never touch the sprint rows, so this reads the three levels itself.
 */
const lifeOf = async (companyId, projectId, sprint) => {
    const project = await findOne(companyId, SCHEMA_TYPE.PROJECTS, { _id: oid(projectId) }, { deletedStatusKey: 1 });
    if (!project) return GONE;
    const states = [project, sprint, ...(await foldersAbove(companyId, sprint))].map((row) => row.deletedStatusKey || 0);
    if (states.includes(DELETED)) return GONE;
    return states.some(Boolean) ? FROZEN : LIVE;
};

/* A board is read by whoever can open its list: the project (Config/contentAccess, which leaves someone else's
 * personal list out for every role) and, for a private list, the people it is shared with plus owners and admins.
 * It is written under the rule a project's docs, forms and links are: no role key, so no existing company is
 * locked out, and a private space only by the people assigned to it. */
const boardAccess = async (companyId, uid, projectId, sprintId) => {
    if (![projectId, sprintId].every((id) => OBJECT_ID.test(String(id || '')))) return NONE;
    const project = await projectAccess(companyId, uid, projectId);
    if (!project.visible) return NONE;
    const sprint = await listOf(companyId, projectId, sprintId);
    if (!sprint) return NONE;
    if (sprint.private === true && !isPrivileged(await getRoleType(companyId, uid)) && !canSeeSprint(sprint, await sprintIdentities(companyId, uid))) return NONE;
    const life = await lifeOf(companyId, projectId, sprint);
    if (life === GONE) return NONE;
    return { visible: true, canEdit: project.canEdit && life === LIVE };
};

module.exports = { boardAccess };

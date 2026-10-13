const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('./schemaType');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { getRoleType, isPrivileged } = require('./permissionGuard');
const { visibleProjectIds } = require('../Modules/Agents/scope');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const TEAM_PREFIX = 'tId_';

const NONE = Object.freeze({ visible: false, canEdit: false, statusCode: 404 });

const isAssigned = async (companyId, project, uid) => {
    const assignees = (project.AssigneeUserId || []).map(String);
    if (assignees.includes(uid)) return true;
    const teamIds = assignees.filter((a) => a.startsWith(TEAM_PREFIX)).map((a) => a.slice(TEAM_PREFIX.length)).filter((id) => OBJECT_ID.test(id));
    if (!teamIds.length) return false;
    const teams = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TEAMS_MANAGEMENT,
        data: [{ _id: { $in: teamIds.map((id) => new mongoose.Types.ObjectId(id)) } }, { assigneeUsersArray: 1 }],
    }, 'find');
    return (teams || []).some((team) => (team.assigneeUsersArray || []).map(String).includes(uid));
};

/*
 * Seeing a project follows Modules/Agents/scope (the project list's own rule). Editing it
 * mirrors the membership half of canEditProject in Config/projectAccess.js: a public space belongs to every
 * member, a private one only to its assignees, and owner and admin reach everything. Role
 * keys are deliberately not consulted: Member is seeded with read-only project_details, so
 * requiring it would lock members out of their own projects' docs, forms and links.
 */
const projectAccess = async (companyId, uid, projectId) => {
    const company = String(companyId || '');
    const user = String(uid || '');
    const id = String(projectId || '');
    if (!OBJECT_ID.test(company) || !OBJECT_ID.test(user) || !OBJECT_ID.test(id)) return NONE;

    const roleType = await getRoleType(company, user);
    if (roleType === null) return NONE;

    const visible = (await visibleProjectIds(company, user)).includes(id);
    if (!visible) return NONE;
    if (isPrivileged(roleType)) return { visible: true, canEdit: true, statusCode: 200 };

    const project = await MongoDbCrudOpration(company, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [{ _id: new mongoose.Types.ObjectId(id) }, { isPrivateSpace: 1, AssigneeUserId: 1 }],
    }, 'findOne');
    if (!project) return NONE;
    const canEdit = project.isPrivateSpace !== true || await isAssigned(company, project, user);
    return { visible: true, canEdit, statusCode: canEdit ? 200 : 403 };
};

const isCompanyAdmin = async (companyId, uid) => isPrivileged(await getRoleType(String(companyId || ''), String(uid || '')));

const isCompanyMember = async (companyId, uid) => (await getRoleType(String(companyId || ''), String(uid || ''))) !== null;

module.exports = { projectAccess, isCompanyAdmin, isCompanyMember, visibleProjectIds };

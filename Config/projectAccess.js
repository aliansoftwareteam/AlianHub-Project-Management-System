const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('./schemaType');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { getRoleType, isPrivileged, evaluatePermission, isWritable, fineGrainedEnforced } = require('./permissionGuard');
const logger = require('./loggerConfig');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const TEAM_PREFIX = 'tId_';
const PRIVATE_VISIBLE_TO_EVERYONE = 2;

const DETAILS = 'project.project_details';
const DELETE_OR_CLOSE = ['project.project_delete', 'project.project_close'];
const STATUS_OR_CLOSE = ['project.project_status_change', 'project.project_close'];
const SECURITY_SETTINGS = 'settings.settings_security_permissions';

// Each entry is an any-of list: the edit passes when one of the keys is writable. The pairs
// mirror the web app, which reaches the same field from more than one gated control.
// An empty list means the field belongs to the caller (favourites, watch settings), so
// project membership is enough. A field not listed falls back to project_details.
const FIELD_PERMISSIONS = {
    ProjectName: ['project.project_name_edit'],
    Description: ['project.project_description'],
    descriptionBlock: ['project.project_description'],
    AssigneeUserId: ['project.project_assignee'],
    LeadUserId: ['project.project_assignee'],
    status: STATUS_OR_CLOSE,
    statusType: STATUS_OR_CLOSE,
    deletedStatusKey: DELETE_OR_CLOSE,
    ProjectType: ['project.project_type'],
    ProjectCurrency: ['project.project_currency'],
    BillingPeriod: ['project.project_currency'],
    DueDate: ['project.project_due_date'],
    dueDateDeadLine: ['project.project_due_date'],
    StartDate: ['project.project_start_date'],
    EndDate: ['project.project_end_date'],
    source: ['project.project_source'],
    proposalId: ['project.project_source'],
    attachments: ['project.project_attachments'],
    customField: ['project.project_custom_field'],
    checklistArray: ['project.project_checklist'],
    tagsArray: ['task.task_tag'],
    projectIcon: ['project.project_create', DETAILS],
    ProjectRequiredComponent: ['project.view_list', DETAILS],
    viewColumn: ['task.list_view_column'],
    isGlobalPermission: [SECURITY_SETTINGS],
    favouriteTasks: [],
    watchers: [],
};

const fieldsOf = (updateObject) => Object.entries(updateObject || {}).flatMap(([field, value]) => (
    field.startsWith('$') && value && typeof value === 'object' ? fieldsOf(value) : [field.split('.')[0]]
));

const permissionsForProjectUpdate = (updateObject) => {
    const groups = fieldsOf(updateObject).map((field) => FIELD_PERMISSIONS[field] || [DETAILS]);
    const seen = new Set();
    return groups.filter((group) => group.length).filter((group) => {
        const id = group.join('|');
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    });
};

const toGroups = (permissions) => (permissions || []).map((p) => (Array.isArray(p) ? p : [p])).filter((g) => g.length);

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

// Settings keys never live in a project's own rules, so they are always read company-wide.
const anyWritable = async (companyId, uid, projectId, keys) => {
    for (const key of keys) {
        const scope = key.startsWith('settings.') ? {} : { projectId };
        if (isWritable(await evaluatePermission(companyId, uid, key, scope))) return true;
    }
    return false;
};

const NOT_FOUND = { allowed: false, statusCode: 404 };
const forbidden = (permission) => ({ allowed: false, statusCode: 403, permission });

/*
 * Public spaces have no member list in the web app (the assignee picker only exists on
 * private spaces), so every company member counts as a member of a public project and
 * the catalogue alone decides. A private space the caller is not assigned to answers 404
 * unless their role may list every private space, in which case its existence is no
 * secret and the answer is 403.
 */
const canEditProject = async (companyId, uid, projectId, permissions = []) => {
    const company = String(companyId || '');
    const user = String(uid || '');
    const id = String(projectId || '');
    if (!OBJECT_ID.test(company) || !OBJECT_ID.test(user) || !OBJECT_ID.test(id)) return NOT_FOUND;

    const roleType = await getRoleType(company, user);
    if (roleType === null) return NOT_FOUND;

    const project = await MongoDbCrudOpration(company, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [{ _id: new mongoose.Types.ObjectId(id) }, { isPrivateSpace: 1, AssigneeUserId: 1, isPersonal: 1, personalOwner: 1 }],
    }, 'findOne');
    if (!project) return NOT_FOUND;
    if (project.isPersonal === true) return String(project.personalOwner) === user ? { allowed: true } : NOT_FOUND;
    if (isPrivileged(roleType)) return { allowed: true };

    if (project.isPrivateSpace === true && !(await isAssigned(company, project, user))) {
        const privateProjects = await evaluatePermission(company, user, 'project.private_projects');
        return privateProjects === PRIVATE_VISIBLE_TO_EVERYONE ? forbidden(null) : NOT_FOUND;
    }

    if (!fineGrainedEnforced()) return { allowed: true };
    for (const group of toGroups(permissions)) {
        if (!(await anyWritable(company, user, id, group))) return forbidden(group[0]);
    }
    return { allowed: true };
};

const refuse = (res, decision) => {
    if (decision.statusCode === 404) {
        return res.status(404).json({ status: false, statusText: 'Project not found.', error: 'Not Found' });
    }
    return res.status(403).json({
        status: false,
        statusText: 'You do not have permission to perform this action.',
        error: 'Forbidden',
        ...(decision.permission ? { permission: decision.permission } : {}),
    });
};

const asList = (value) => (Array.isArray(value) ? value : [value]).filter((v) => v !== undefined && v !== null && v !== '');

/*
 * Express middleware. `projectIds(req)` returns one id or a list (sync or async); a request
 * that names no well-formed id passes through so the handler's own validation answers it.
 * `permissions(req)` returns permission keys or any-of lists. Some handlers take the tenant
 * from the body rather than the header, so a body companyId that disagrees with the header
 * is refused here: otherwise the check would run in one company and the write in another.
 */
const requireProjectAccess = ({ projectIds, permissions = () => [] }) => async (req, res, next) => {
    try {
        const companyId = String(req.headers['companyid'] || '');
        const bodyCompany = req.body && (req.body.companyId || req.body.CompanyId);
        if (bodyCompany && String(bodyCompany) !== companyId) {
            return res.status(403).json({ status: false, statusText: 'You do not have access to this company', error: 'Forbidden' });
        }
        const ids = asList(await projectIds(req)).map(String).filter((id) => OBJECT_ID.test(id));
        if (!ids.length) return next();
        const keys = await permissions(req);
        for (const id of [...new Set(ids)]) {
            const decision = await canEditProject(companyId, req.uid, id, keys);
            if (!decision.allowed) return refuse(res, decision);
        }
        return next();
    } catch (error) {
        logger.error(`requireProjectAccess error: ${error.message || error}`);
        return res.status(403).json({ status: false, statusText: 'Permission check failed.', error: 'Forbidden' });
    }
};

module.exports = {
    FIELD_PERMISSIONS,
    DELETE_OR_CLOSE,
    STATUS_OR_CLOSE,
    SECURITY_SETTINGS,
    DETAILS,
    permissionsForProjectUpdate,
    canEditProject,
    requireProjectAccess,
};

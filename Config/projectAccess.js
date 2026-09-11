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
const MISSING = { allowed: false, statusCode: 404, missing: true };
const forbidden = (permission) => ({ allowed: false, statusCode: 403, permission });

const READ = 'read';
const WRITE = 'write';

/*
 * Public spaces have no member list in the web app (the assignee picker only exists on
 * private spaces), so every company member counts as a member of a public project and
 * the catalogue alone decides. A private space the caller is not assigned to answers 404
 * unless their role may list every private space: then it is readable, and a write
 * answers 403 because its existence is no secret.
 */
const decideProjectAccess = async (companyId, uid, projectId, { mode = WRITE, permissions = [] } = {}) => {
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
    if (!project) return MISSING;
    if (project.isPersonal === true) return String(project.personalOwner) === user ? { allowed: true } : NOT_FOUND;
    if (isPrivileged(roleType)) return { allowed: true };

    if (project.isPrivateSpace === true && !(await isAssigned(company, project, user))) {
        const privateProjects = await evaluatePermission(company, user, 'project.private_projects');
        if (privateProjects !== PRIVATE_VISIBLE_TO_EVERYONE) return NOT_FOUND;
        if (mode !== READ) return forbidden(null);
    }

    if (mode === READ || !fineGrainedEnforced()) return { allowed: true };
    for (const group of toGroups(permissions)) {
        if (!(await anyWritable(company, user, id, group))) return forbidden(group[0]);
    }
    return { allowed: true };
};

const canEditProject = (companyId, uid, projectId, permissions = []) => decideProjectAccess(companyId, uid, projectId, { mode: WRITE, permissions });
const canReadProject = (companyId, uid, projectId) => decideProjectAccess(companyId, uid, projectId, { mode: READ });

const visibleProjectIds = async (companyId, uid, projectIds) => {
    const visible = [];
    for (const id of [...new Set((projectIds || []).map(String))]) {
        if ((await canReadProject(companyId, uid, id)).allowed) visible.push(id);
    }
    return visible;
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

const PROJECT_FIELD = {
    [SCHEMA_TYPE.SPRINTS]: 'projectId',
    [SCHEMA_TYPE.FOLDERS]: 'projectId',
    [SCHEMA_TYPE.MILESTONE]: 'projectId',
    [SCHEMA_TYPE.EPICS]: 'ProjectID',
    [SCHEMA_TYPE.RECURRING_TASKS]: 'ProjectID',
    [SCHEMA_TYPE.TASKS]: 'ProjectID',
};

const idsIn = (value) => asList(value).map((v) => (v && typeof v === 'object' ? (v._id || v.id) : v)).map(String).filter((id) => OBJECT_ID.test(id));

/*
 * The project of a sprint, epic or milestone is read from the stored record, so a client
 * cannot pair its own project id with someone else's record. Ids the handler also takes
 * from the request (`direct`) are checked too.
 */
const projectIdsFrom = ({ records = [], direct = () => [] }) => async (req) => {
    const companyId = String(req.headers['companyid'] || '');
    const ids = [];
    for (const [type, pick] of records) {
        const recordIds = idsIn(await pick(req));
        if (!recordIds.length || !OBJECT_ID.test(companyId)) continue;
        const field = PROJECT_FIELD[type];
        const docs = await MongoDbCrudOpration(companyId, {
            type,
            data: [{ _id: { $in: recordIds.map((id) => new mongoose.Types.ObjectId(id)) } }, { [field]: 1, mainChat: 1 }],
        }, 'find');
        (docs || []).forEach((doc) => { if (doc[field]) ids.push(String(doc[field])); });
    }
    return [...ids, ...idsIn(await direct(req))];
};

/*
 * Express middleware. `mode` is 'read' (the project must be visible to the caller) or
 * 'write' (visible, plus the permission keys). `projectIds(req)` returns one id or a list
 * (sync or async); a request that names no well-formed id passes through so the handler's
 * own validation answers it. `permissions(req)` returns permission keys or any-of lists.
 * An id with no project behind it passes when `passMissing(req)` says so (reads always):
 * there is nothing to protect, and chat containers live outside the projects collection.
 * Some handlers take the tenant from the body rather than the header, so a body companyId
 * that disagrees with the header is refused here: otherwise the check would run in one
 * company and the handler in another.
 */
const requireProjectAccess = ({ mode = WRITE, projectIds, permissions = () => [], passMissing = () => mode === READ }) => async (req, res, next) => {
    try {
        const companyId = String(req.headers['companyid'] || '');
        const bodyCompany = req.body && (req.body.companyId || req.body.CompanyId);
        if (bodyCompany && String(bodyCompany) !== companyId) {
            return res.status(403).json({ status: false, statusText: 'You do not have access to this company', error: 'Forbidden' });
        }
        const ids = asList(await projectIds(req)).map(String).filter((id) => OBJECT_ID.test(id));
        if (!ids.length) return next();
        const keys = mode === READ ? [] : await permissions(req);
        for (const id of [...new Set(ids)]) {
            const decision = await decideProjectAccess(companyId, req.uid, id, { mode, permissions: keys });
            if (decision.missing && passMissing(req)) continue;
            if (!decision.allowed) return refuse(res, decision);
        }
        return next();
    } catch (error) {
        logger.error(`requireProjectAccess error: ${error.message || error}`);
        return res.status(403).json({ status: false, statusText: 'Permission check failed.', error: 'Forbidden' });
    }
};

/* For list-shaped reads: the project ids in the request are narrowed to the visible ones. */
const keepVisibleProjects = ({ get, set }) => async (req, res, next) => {
    try {
        const ids = get(req);
        if (!Array.isArray(ids)) return next();
        set(req, await visibleProjectIds(String(req.headers['companyid'] || ''), req.uid, ids));
        return next();
    } catch (error) {
        logger.error(`keepVisibleProjects error: ${error.message || error}`);
        return res.status(403).json({ status: false, statusText: 'Permission check failed.', error: 'Forbidden' });
    }
};

module.exports = {
    FIELD_PERMISSIONS,
    DELETE_OR_CLOSE,
    STATUS_OR_CLOSE,
    SECURITY_SETTINGS,
    DETAILS,
    READ,
    WRITE,
    fieldsOf,
    permissionsForProjectUpdate,
    canEditProject,
    canReadProject,
    visibleProjectIds,
    projectIdsFrom,
    requireProjectAccess,
    keepVisibleProjects,
};

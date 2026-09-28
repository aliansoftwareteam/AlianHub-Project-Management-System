const { canReadProject, canEditProject } = require('../../Config/projectAccess');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { namedCompanyIds } = require('../../Config/tenant');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const CREATE_TASKS = 'task.task_create';
const PROJECT_SETTINGS = 'project.project_details';

const ALLOWED = Object.freeze({ allowed: true });
const FORBIDDEN = Object.freeze({ allowed: false, statusCode: 403 });

/* The one company the request names; a body or query naming a second one is refused rather than resolved. */
const companyOf = (req) => {
    const named = namedCompanyIds(req);
    return named.length === 1 && OBJECT_ID.test(named[0]) ? named[0] : '';
};

const isAdmin = async (companyId, uid) => isPrivileged(await getRoleType(companyId, uid));

/* Project templates are kept by whoever may create tasks in that project; workspace templates by owners and admins. */
const canSaveIn = async (companyId, uid, { scope, projectId }) => {
    if (scope === 'workspace') return (await isAdmin(companyId, uid)) ? ALLOWED : FORBIDDEN;
    return canEditProject(companyId, uid, projectId, [CREATE_TASKS]);
};

const canManage = (companyId, uid, template) => canSaveIn(companyId, uid, {
    scope: template.scope,
    projectId: template.ProjectID ? String(template.ProjectID) : '',
});

const usableIn = (template, projectId) => template.scope === 'workspace' || String(template.ProjectID) === String(projectId);

/* One answer per key for the request, since a template touches several fields gated by the same few keys. */
const keyChecker = (companyId, uid, projectId) => {
    const answers = new Map();
    return async (key) => {
        if (!answers.has(key)) answers.set(key, (await canEditProject(companyId, uid, projectId, [key])).allowed);
        return answers.get(key);
    };
};

/* Assignees must hold an active seat and be able to open the project, the same test the project routes apply. */
const assignableIn = async (companyId, projectId, ids) => {
    const unique = [...new Set((ids || []).map(String))].filter((id) => OBJECT_ID.test(id));
    const verdicts = await Promise.all(unique.map(async (id) => [id, (await canReadProject(companyId, id, projectId)).allowed]));
    return new Set(verdicts.filter(([, allowed]) => allowed).map(([id]) => id));
};

module.exports = {
    OBJECT_ID,
    CREATE_TASKS,
    PROJECT_SETTINGS,
    companyOf,
    isAdmin,
    canSaveIn,
    canManage,
    usableIn,
    keyChecker,
    assignableIn,
    canReadProject,
    canEditProject,
};

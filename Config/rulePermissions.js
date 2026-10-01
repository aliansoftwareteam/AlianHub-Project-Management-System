// How a role's value is read out of the RULES list. Kept free of requires so the permission
// guard and the project list (Modules/Agents/scope) resolve the same value for the same role.

/** Arrange the flat RULES array into the nested object the frontend uses. */
const arrangeRules = (rawRules) => {
    const arranged = {};
    const rules = [...(rawRules || [])].filter(Boolean).sort((a, b) => (a.isParent > b.isParent ? -1 : 1));
    rules.forEach((rule) => {
        const ownKey = rule.key ? rule.key : String(rule.name || "").replaceAll(" ", "_").toLowerCase();
        if (rule.isParent) {
            arranged[ownKey] = { ...rule };
        } else {
            const parent = rules.find((x) => String(x._id) === String(rule.parentId));
            if (parent && parent.key && arranged[parent.key]) {
                arranged[parent.key][ownKey] = rule;
            }
        }
    });
    return arranged;
};

const lookupRule = (arranged, path) => {
    let rule = null;
    for (const segment of String(path).split('.')) {
        rule = rule ? rule[segment] : arranged[segment];
        if (rule === undefined || rule === null) return null;
    }
    return rule && Array.isArray(rule.roles) ? rule : null;
};

const rolePermission = (arranged, roleType, path) => {
    const rule = lookupRule(arranged, path);
    const match = rule && rule.roles.find((r) => r.key === roleType);
    return match ? match.permission : null;
};

const isWritable = (permission) => permission === true || permission === 1 || permission === 2;
const isReadable = (permission) => permission !== null && permission !== undefined && permission !== 0;

const TASK_LIST = 'task.task_list';

/* What a role holds for a key in a project: by the project's own rules when it has them, by the
 * company's otherwise (usesProjectRules in Config/permissionGuard.js). */
const projectPermissions = (roleType, companyRules, projectRules) => {
    const rulesOf = new Map();
    (projectRules || []).forEach((rule) => {
        const id = String(rule.projectId);
        rulesOf.set(id, [...(rulesOf.get(id) || []), rule]);
    });
    const company = arrangeRules(companyRules);
    const arranged = new Map();
    const own = (id) => {
        if (!arranged.has(id)) arranged.set(id, arrangeRules(rulesOf.get(id) || []));
        return arranged.get(id);
    };
    return (project, path) => rolePermission(project.isGlobalPermission === false ? own(String(project._id)) : company, roleType, path);
};

/* The project page shows no task to a role whose task list permission is unset. Read-only still
 * reads. The caller's own personal list is theirs whatever their role allows elsewhere, so the
 * projects given must already leave out the personal lists of other people. */
const taskListProjectIds = (projects, roleType, companyRules, projectRules) => {
    const permissionOf = projectPermissions(roleType, companyRules, projectRules);
    return projects
        .filter((project) => project.isPersonal === true || isReadable(permissionOf(project, TASK_LIST)))
        .map((project) => String(project._id));
};

const PRIVATE_PROJECTS = 'project.private_projects';
const PRIVATE_VISIBLE_TO_EVERYONE = 2;

// Any other value leaves a private project to its assignees.
const seesEveryPrivateProject = (permission) => permission === PRIVATE_VISIBLE_TO_EVERYONE;

module.exports = {
    arrangeRules,
    rolePermission,
    isWritable,
    isReadable,
    TASK_LIST,
    projectPermissions,
    taskListProjectIds,
    PRIVATE_PROJECTS,
    seesEveryPrivateProject,
};

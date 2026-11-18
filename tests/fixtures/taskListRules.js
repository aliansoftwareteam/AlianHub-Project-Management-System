/* The rule rows importCompanyRoles stores for the task list, granting it to the given roles.
 * `roles` maps a role key to its permission: true edits, false reads, and a role left out is unset. */
const taskListRules = (roles = { 0: false, 3: true }, extra = {}) => {
    const parentId = `rule-task-${extra.projectId || 'company'}`;
    return [
        { _id: parentId, key: 'task', name: 'Task', isParent: true, roles: [], ...extra },
        {
            _id: `${parentId}-list`,
            key: 'task_list',
            name: 'Task List',
            isParent: false,
            parentId,
            roles: Object.entries(roles).map(([key, permission]) => ({ key: Number(key), permission })),
            ...extra,
        },
    ];
};

/* Stores them the way the given project keeps its own rules, or as the company's when none is named. */
const seedTaskListRules = (db, roles, { projectId } = {}) => taskListRules(roles, projectId ? { projectId } : {})
    .map((rule) => db.seed(projectId ? 'projectRules' : 'rules', rule));

/* A stand-in for Modules/Tasks/helpers/taskListProjects in a suite about some other rule: every
 * role holds the task list everywhere, so the projects a caller can open are the ones they list. */
const taskListHeldEverywhere = () => ({
    TASK_LIST: 'task.task_list',
    taskListProjectIds: (companyId, uid) => require('../../Modules/Agents/scope').visibleProjectIds(companyId, uid),
    keepTaskListProjectIds: async (companyId, uid, projectIds) => [...new Set((projectIds || []).map(String))],
    mayListTasksIn: async () => true,
});

module.exports = { taskListRules, seedTaskListRules, taskListHeldEverywhere };

const { requireTaskWritePermission } = require('../../../Config/permissionGuard');
const { TASK_ACTIONS } = require('../../../Config/taskWritePermissions');
const { nonMembersOf, NOT_A_MEMBER } = require('../../../Config/companyMembers');
const { cannotOpen, CANNOT_OPEN_PROJECT } = require('../../../Config/projectPeople');

/* Moving a plan to another day writes the task's due date, and to another person its assignee. */
const taskActionsOf = (body) => [
    ...(body.fromDate !== body.toDate ? [TASK_ACTIONS.updateDueDate] : []),
    ...(String(body.toUserId || body.fromUserId || '') !== String(body.fromUserId || '') ? [TASK_ACTIONS.updateAssignee] : []),
];

/* Each field is judged by the guard of the task route that writes it, on a body shaped the way that route
 * names its task, so a plan move is allowed and refused exactly where the same change on the task is. */
const requireMovedTaskFields = (req, res, next) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const asTaskRoute = Object.assign(Object.create(req), { body: { taskData: { _id: body.taskId } } });
    const actions = taskActionsOf(body);
    const judge = (at) => (at === actions.length ? next() : requireTaskWritePermission(actions[at])(asTaskRoute, res, () => judge(at + 1)));
    return judge(0);
};

/* Why `userId` cannot be put on the task, as the assignee route would say it; '' when they can. */
const assigneeProblem = async (companyId, task, userId) => {
    if ((await nonMembersOf(companyId, [userId])).length) return NOT_A_MEMBER;
    return await cannotOpen(companyId, String(task.ProjectID), [userId]) ? CANNOT_OPEN_PROJECT : '';
};

module.exports = { requireMovedTaskFields, assigneeProblem };

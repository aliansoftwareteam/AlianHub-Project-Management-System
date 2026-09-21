const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { canEditProject } = require('../../Config/projectAccess');
const visibility = require('../Mcp/visibility');
const { canSeeSprint, sprintIdentities } = require('../Sprints/helpers/sprintVisibility');
const { toOid } = require('./store');

const EDIT_KEYS = ['task.task_assignee', 'task.task_status'];
const TASK_FIELDS = { ProjectID: 1, sprintId: 1, AssigneeUserId: 1, TaskName: 1, TaskKey: 1, CompanyId: 1 };

const taskOf = async (companyId, taskId) => {
    const _id = toOid(taskId);
    if (!_id) return null;
    return MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.TASKS, data: [{ _id, deletedStatusKey: { $ne: 1 } }, TASK_FIELDS] }, 'findOne');
};

/* Exactly what the person could open in the web app, as the MCP tools judge it. */
const canOpenTask = async (companyId, uid, task) => {
    if (!task || !uid) return false;
    const vis = await visibility.forCaller({ companyId: String(companyId), userId: String(uid), projectIds: [] });
    return vis.allowsTask(task);
};

const canEditTask = async (companyId, uid, task) => {
    if (!(await canOpenTask(companyId, uid, task))) return false;
    const verdict = await canEditProject(String(companyId), String(uid), String(task.ProjectID), [EDIT_KEYS]);
    return Boolean(verdict && verdict.allowed);
};

const privateSprintOf = async (companyId, sprintId) => {
    const _id = toOid(sprintId);
    if (!_id) return null;
    const sprint = await MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.SPRINTS, data: [{ _id }, { private: 1, AssigneeUserId: 1 }] }, 'findOne');
    return sprint && sprint.private === true ? sprint : null;
};

/* Membership proper: owners and admins read past sprint privacy, but that does not make them members. */
const isSprintMember = async (companyId, uid, sprint) => canSeeSprint(sprint, await sprintIdentities(String(companyId), String(uid)));

module.exports = { EDIT_KEYS, taskOf, canOpenTask, canEditTask, privateSprintOf, isSprintMember };

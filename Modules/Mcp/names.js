const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { oid } = require('../Automations/engine/tools');
const scope = require('../Agents/scope');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { canSeeSprint, sprintIdentities } = require('../Sprints/helpers/sprintVisibility');

// Names sit next to ids so an MCP client can talk about a record without a
// second lookup. Everything named under a project (the project itself, its
// sprints, its people and task types) is resolved only when the caller may open
// that project and the token is not narrowed away from it; a private sprint's
// name also needs the caller on the sprint, as it does in the web app.

const PRIORITY_NAMES = Object.freeze({ URGENT: 'Urgent', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' });

const idOf = (v) => (v === undefined || v === null ? '' : String(v));
const unique = (ids) => [...new Set(ids.map(idOf).filter(Boolean))];
const oids = (ids) => ids.map(oid).filter(Boolean);
const personName = (u) => u.Employee_Name || [u.Employee_FName, u.Employee_LName].filter(Boolean).join(' ') || null;

const find = async (db, type, filter, fields) => (await MongoDbCrudOpration(db, { type, data: [filter, fields] }, 'find')) || [];

const projectGate = async (ctx) => {
    const visible = new Set((await scope.visibleProjectIds(ctx.companyId, String(ctx.userId))).map(String));
    const narrowed = Array.isArray(ctx.projectIds) && ctx.projectIds.length ? new Set(ctx.projectIds.map(String)) : null;
    return (id) => Boolean(id) && visible.has(id) && (!narrowed || narrowed.has(id));
};

/* One lookup per collection for a whole page of records. */
const resolver = async (ctx, { projectIds = [], sprintIds = [], userIds = [] }) => {
    const opens = await projectGate(ctx);
    const openIds = unique(projectIds).filter(opens);
    const sprintList = unique(sprintIds);
    const userList = unique(userIds);
    const [projects, sprints, members, identities, role] = await Promise.all([
        openIds.length ? find(ctx.companyId, SCHEMA_TYPE.PROJECTS, { _id: { $in: oids(openIds) } }, { ProjectName: 1, taskTypeCounts: 1 }) : [],
        sprintList.length ? find(ctx.companyId, SCHEMA_TYPE.SPRINTS, { _id: { $in: oids(sprintList) } }, { name: 1, sprintName: 1, private: 1, AssigneeUserId: 1 }) : [],
        userList.length ? find(ctx.companyId, SCHEMA_TYPE.COMPANY_USERS, { userId: { $in: userList }, isDelete: { $ne: true } }, { userId: 1 }) : [],
        sprintList.length ? sprintIdentities(ctx.companyId, String(ctx.userId)) : [],
        sprintList.length ? getRoleType(ctx.companyId, String(ctx.userId)) : null,
    ]);
    const memberIds = unique(members.map((m) => m.userId));
    const people = memberIds.length
        ? await find(dbCollections.GLOBAL, SCHEMA_TYPE.USERS, { _id: { $in: oids(memberIds) } }, { Employee_Name: 1, Employee_FName: 1, Employee_LName: 1 })
        : [];

    const projectById = new Map(projects.map((p) => [idOf(p._id), p]));
    const sprintById = new Map(sprints.map((s) => [idOf(s._id), s]));
    const personById = new Map(people.map((u) => [idOf(u._id), personName(u)]));
    const seesPrivate = isPrivileged(role);

    const project = (id) => ({ id, name: opens(id) && projectById.has(id) ? projectById.get(id).ProjectName || null : null });
    const sprint = (id, projectId) => {
        const row = sprintById.get(id);
        const named = row && opens(projectId) && (seesPrivate || canSeeSprint(row, identities));
        return { id, name: named ? row.sprintName || row.name || null : null };
    };
    const person = (id, projectId) => ({ id, name: opens(projectId) ? personById.get(id) || null : null });
    const taskType = (t) => {
        const types = opens(idOf(t.ProjectID)) && projectById.get(idOf(t.ProjectID)) ? projectById.get(idOf(t.ProjectID)).taskTypeCounts || [] : [];
        const match = types.find((type) => type && t.TaskTypeKey !== undefined && String(type.key) === String(t.TaskTypeKey));
        return { key: t.TaskTypeKey === undefined ? null : t.TaskTypeKey, name: (match && match.name) || t.TaskType || null };
    };
    return { project, sprint, person, taskType };
};

const taskNames = (names, t) => {
    const projectId = idOf(t.ProjectID);
    const sprintId = idOf(t.sprintId);
    const priority = String(t.Task_Priority || '');
    return {
        ref: `task:${t._id}`,
        priorityName: PRIORITY_NAMES[priority.toUpperCase()] || priority,
        project: names.project(projectId),
        sprint: sprintId ? names.sprint(sprintId, projectId) : null,
        assignees: (Array.isArray(t.AssigneeUserId) ? t.AssigneeUserId : []).map(idOf).filter(Boolean).map((id) => names.person(id, projectId)),
        taskType: names.taskType(t),
    };
};

/* Each task row with its ref and the names the caller may see. */
const forTasks = async (ctx, tasks, row) => {
    const list = tasks || [];
    const names = await resolver(ctx, {
        projectIds: list.map((t) => t.ProjectID),
        sprintIds: list.map((t) => t.sprintId),
        userIds: list.flatMap((t) => (Array.isArray(t.AssigneeUserId) ? t.AssigneeUserId : [])),
    });
    return list.map((t) => ({ ...row(t), ...taskNames(names, t) }));
};

const forPage = async (ctx, page) => {
    const projectId = idOf(page.ProjectID);
    const names = await resolver(ctx, { projectIds: [projectId] });
    return { ref: `page:${page._id}`, project: projectId ? names.project(projectId) : null };
};

module.exports = { PRIORITY_NAMES, forTasks, forPage };

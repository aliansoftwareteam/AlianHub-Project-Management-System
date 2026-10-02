const { canReadProject, readableProjects } = require('../../../Config/projectAccess');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');
const { canSeeSprintById, hiddenAmong } = require('../../Sprints/helpers/sprintVisibility');
const { mayListTasksIn, keepTaskListProjectIds } = require('./taskListProjects');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { visibilityStage, toObjectIds } = require('./taskQueryGuard');
const { inConversation } = require('../../Comments/helpers/conversationReaders');

/* Deleted, archived, or in a deleted project. */
const NOT_LIVE = Object.freeze([1, 2, 7]);

/* A record with no project behind it has no project rule to inherit. The only such records the
 * app writes are main-chat conversations, which belong to the people in them, owners included;
 * anything else (a task whose project is gone) is refused. A conversation kept in a project is
 * read by the people in it who can open that project, and by nobody else who can. */
const canReadTask = async (companyId, uid, task) => {
    if (!task) return false;
    const project = await canReadProject(companyId, uid, task.ProjectID);
    if (project.missing) return task.mainChat === true && inConversation(task, uid);
    if (!project.allowed) return false;
    if (task.mainChat === true && !inConversation(task, uid)) return false;
    if (isPrivileged(await getRoleType(companyId, uid))) return true;
    if (!(await mayListTasksIn(companyId, uid, task.ProjectID))) return false;
    return canSeeSprintById(companyId, uid, task.sprintId);
};

const TASK_READ_FIELDS = Object.freeze({ ProjectID: 1, sprintId: 1, mainChat: 1, AssigneeUserId: 1 });

/* canReadTask for many rows (read with TASK_READ_FIELDS) at a fixed cost: the person's standing once, the projects
 * in one read, the task-list rule once and the private lists in one read, however many places the rows sit in. */
const readableTasks = async (companyId, uid, rows) => {
    const tasks = (rows || []).filter((row) => row && row.ProjectID);
    if (!tasks.length) return [];
    const person = String(uid || '');
    const { standing, found, open } = await readableProjects(companyId, person, tasks.map((task) => task.ProjectID));
    const [listed, hidden] = standing.privileged ? [null, []] : await Promise.all([
        keepTaskListProjectIds(companyId, person, [...open.keys()]),
        hiddenAmong(companyId, person, tasks.map((task) => task.sprintId).filter(Boolean)),
    ]);
    return tasks.filter((task) => {
        const projectId = String(task.ProjectID);
        if (!found.has(projectId)) return task.mainChat === true && inConversation(task, person);
        if (!open.has(projectId) || (task.mainChat === true && !inConversation(task, person))) return false;
        return standing.privileged || (listed.map(String).includes(projectId) && !hidden.includes(String(task.sprintId)));
    });
};

/* Which of `ids` the person can open, read in one query under the rule the task query applies to every read. A chat row is
 * not a task anyone links to or votes on, so it is never among them. `live` leaves out what is deleted or archived. */
const openableTasks = async (companyId, uid, ids, { projection = {}, live = true } = {}) => {
    const wanted = toObjectIds([...new Set((ids || []).map(String))]);
    if (!wanted.length || !uid) return [];
    const scope = await visibilityStage(companyId, String(uid));
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [[
            scope,
            { $match: { _id: { $in: wanted }, mainChat: { $ne: true }, ...(live ? { deletedStatusKey: { $nin: NOT_LIVE } } : {}) } },
            { $project: { ...projection, _id: 1 } },
        ]],
    }, 'aggregate');
    return rows || [];
};

module.exports = { canReadTask, openableTasks, readableTasks, TASK_READ_FIELDS };

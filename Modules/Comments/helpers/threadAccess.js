const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { canReadProject } = require('../../../Config/projectAccess');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');
const { canSeeSprintById, hiddenSprintIds } = require('../../Sprints/helpers/sprintVisibility');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const isId = (value) => OBJECT_ID.test(String(value || ''));
const oid = (id) => new mongoose.Types.ObjectId(String(id));

const INVALID = { allowed: false, statusCode: 400 };
const NOT_FOUND = { allowed: false, statusCode: 404 };

const findOne = (companyId, type, id, fields) => MongoDbCrudOpration(companyId, { type, data: [{ _id: oid(id) }, fields] }, 'findOne');

/* Chat spaces are main_chats rows, not projects. The default one holds direct messages. */
const chatSpace = (companyId, id) => findOne(companyId, SCHEMA_TYPE.MAIN_CHATS, id, { default: 1 });

/* The answer GET /api/v1/task/:id and the comment room join give; a direct message is only its
 * participants', owners included. */
const canOpenTask = async (companyId, uid, task, privileged) => {
    if (task.mainChat === true) return (task.AssigneeUserId || []).map(String).includes(uid);
    const project = await canReadProject(companyId, uid, task.ProjectID);
    if (!project.allowed && !project.missing) return false;
    return privileged || canSeeSprintById(companyId, uid, task.sprintId);
};

/*
 * Decides a comment read addressed by project, sprint and task ids. Each id the read filters on is
 * checked against its stored record, and a task must sit in the named project, so a readable
 * project id cannot carry another project's thread. `match` hides the private sprints the caller
 * is not on from a read that spans the whole project.
 */
const commentThreadAccess = async (companyId, uid, { projectId, sprintId, taskId } = {}) => {
    const company = String(companyId || '');
    const user = String(uid || '');
    if (!isId(projectId)) return INVALID;
    if (!isId(company) || !isId(user)) return NOT_FOUND;

    const project = await canReadProject(company, user, projectId);
    if (!project.allowed) {
        if (!project.missing) return NOT_FOUND;
        const space = await chatSpace(company, projectId);
        if (!space || (space.default === true && !isId(taskId))) return NOT_FOUND;
    }

    const privileged = isPrivileged(await getRoleType(company, user));
    if (isId(taskId)) {
        const task = await findOne(company, SCHEMA_TYPE.TASKS, taskId, { ProjectID: 1, sprintId: 1, mainChat: 1, AssigneeUserId: 1 });
        if (!task || String(task.ProjectID) !== String(projectId)) return NOT_FOUND;
        if (!(await canOpenTask(company, user, task, privileged))) return NOT_FOUND;
    }
    if (isId(sprintId) && !privileged && !(await canSeeSprintById(company, user, sprintId))) return NOT_FOUND;

    const hidden = privileged ? [] : await hiddenSprintIds(company, user, [projectId]);
    return { allowed: true, match: hidden.length ? { sprintId: { $nin: hidden } } : {} };
};

const refuseThread = (res, decision) => (decision.statusCode === 400
    ? res.status(400).json({ status: false, statusText: 'A valid project id is required.', message: 'A valid project id is required.' })
    : res.status(404).json({ status: false, statusText: 'Comments not found.', message: 'Comments not found.' }));

module.exports = { commentThreadAccess, refuseThread };

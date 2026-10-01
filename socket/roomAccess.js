const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { canReadProject } = require('../Config/projectAccess');
const { getRoleType, isPrivileged } = require('../Config/permissionGuard');
const { canSeeSprintById } = require('../Modules/Sprints/helpers/sprintVisibility');
const { canUsePage } = require('../Modules/Pages/helpers/pageAccess');
const { mayListTasksIn } = require('../Modules/Tasks/helpers/taskListProjects');
const logger = require('../Config/loggerConfig');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const NAMESPACE = /^\/userid_([^_]+)_([^_]+)$/;
const ROOM_SEPARATOR = '**';

const inAudience = (aud, companyId) => (Array.isArray(aud) ? aud : String(aud || '').split(','))
    .some((entry) => String(entry).trim() === companyId);

/* The namespace is picked by the client, so it only counts when it names the token's own user and a company the token was issued for. */
const identityOf = (namespaceName, user) => {
    const match = NAMESPACE.exec(String(namespaceName || ''));
    const uid = String((user && user.uid) || '');
    if (!match || !uid) return null;
    const [, companyId, userId] = match;
    if (userId !== uid || !inAudience(user.aud, companyId)) return null;
    return { companyId, uid };
};

const roomFor = (socket, prefix) => `${prefix}${ROOM_SEPARATOR}${socket.id}`;

const prefixOfOwnRoom = (socket, roomName) => {
    const name = String(roomName || '');
    const suffix = `${ROOM_SEPARATOR}${socket.id}`;
    if (!name.endsWith(suffix)) return null;
    const prefix = name.slice(0, -suffix.length);
    return prefix && !prefix.includes(ROOM_SEPARATOR) ? prefix : null;
};

const isSelf = ({ uid }, userId) => String(userId || '') === uid;

/* A project the caller can read, or an id with no project behind it: chat containers live outside the projects collection. */
const projectReadable = async ({ companyId, uid }, projectId) => {
    const access = await canReadProject(companyId, uid, projectId);
    return access.allowed || access.missing === true;
};

/* A task room streams task rows, so its project must be one whose tasks the caller may list. */
const tasksReadable = async ({ companyId, uid }, projectId) => {
    const access = await canReadProject(companyId, uid, projectId);
    if (!access.allowed) return access.missing === true;
    return mayListTasksIn(companyId, uid, projectId);
};

const sprintVisible = async ({ companyId, uid }, sprintId) => (
    isPrivileged(await getRoleType(companyId, uid)) || canSeeSprintById(companyId, uid, sprintId)
);

const findTask = (companyId, taskId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TASKS,
    data: [{ _id: new mongoose.Types.ObjectId(String(taskId)) }, { ProjectID: 1, sprintId: 1, mainChat: 1, AssigneeUserId: 1 }],
}, 'findOne');

/* The same answer GET /api/v1/task/:id gives, plus a direct chat only for its participants. */
const canOpenTask = async (identity, taskId) => {
    if (!OBJECT_ID.test(String(taskId || ''))) return false;
    const task = await findTask(identity.companyId, taskId);
    if (!task) return false;
    if (task.mainChat === true && !(task.AssigneeUserId || []).map(String).includes(identity.uid)) return false;
    if (!(await tasksReadable(identity, task.ProjectID))) return false;
    return sprintVisible(identity, task.sprintId);
};

const canOpenSprintBoard = async (identity, projectId, sprintId) => {
    if (!OBJECT_ID.test(String(projectId || ''))) return false;
    if (!(await tasksReadable(identity, projectId))) return false;
    return sprintVisible(identity, sprintId);
};

const COMMENT_TASK_ROOM = /^comments_([^_]+)_([^_]+)_([^_]+)$/;
const COMMENT_PROJECT_ROOM = /^comments_project_([^_]+)$/;
const PAGE_COMMENT_ROOM = /^pagecomments_([a-f0-9]{24})$/i;

const pageCommentRoomOf = (pageId) => `pagecomments_${pageId}`;

/* The live doc behind a comment room, when this person can still read it. */
const readablePage = async ({ companyId, uid }, pageId) => {
    const page = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PAGES,
        data: [{ _id: new mongoose.Types.ObjectId(String(pageId)), deletedStatusKey: 0 }],
    }, 'findOne');
    return page && await canUsePage(companyId, page, uid) ? page : null;
};

const canOpenComments = async (identity, prefix) => {
    const doc = PAGE_COMMENT_ROOM.exec(prefix);
    if (doc) return Boolean(await readablePage(identity, doc[1]));
    const project = COMMENT_PROJECT_ROOM.exec(prefix);
    if (project) return OBJECT_ID.test(project[1]) && projectReadable(identity, project[1]);
    const task = COMMENT_TASK_ROOM.exec(prefix);
    if (!task) return false;
    const [, projectId, sprintId, taskId] = task;
    if (OBJECT_ID.test(taskId) && await findTask(identity.companyId, taskId)) {
        return canOpenTask(identity, taskId);
    }
    return canOpenSprintBoard(identity, projectId, sprintId);
};

const isCompanyMember = async ({ companyId, uid }, targetCompanyId) => (
    String(targetCompanyId || '') === companyId && (await getRoleType(companyId, uid)) !== null
);

/* Registers a join handler that only joins when `authorise` says so; a refusal is told to the client and joins nothing. */
const onJoin = (socket, event, authorise, joined) => {
    socket.on(event, async (data, ack) => {
        const payload = data && typeof data === 'object' ? data : {};
        let allowed = false;
        try {
            allowed = Boolean(socket.identity) && await authorise(payload, socket.identity);
        } catch (error) {
            logger.error(`Socket ${event} check failed: ${error.message || error}`);
        }
        if (allowed) joined(payload);
        else socket.emit('joinRefused', { event });
        if (typeof ack === 'function') ack({ joined: allowed });
    });
};

module.exports = {
    identityOf,
    roomFor,
    prefixOfOwnRoom,
    isSelf,
    projectReadable,
    canOpenTask,
    canOpenSprintBoard,
    canOpenComments,
    pageCommentRoomOf,
    readablePage,
    isCompanyMember,
    onJoin,
};

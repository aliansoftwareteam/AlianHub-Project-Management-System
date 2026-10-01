const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { canReadProject } = require('../Config/projectAccess');
const { getRoleType, isPrivileged } = require('../Config/permissionGuard');
const { canSeeSprint, canSeeSprintById, sprintIdentities } = require('../Modules/Sprints/helpers/sprintVisibility');
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

const isId = (value) => OBJECT_ID.test(String(value || ''));

const findById = (companyId, type, id, fields) => MongoDbCrudOpration(companyId, {
    type,
    data: [{ _id: new mongoose.Types.ObjectId(String(id)) }, fields],
}, 'findOne');

const PROJECT = 'project';
const CHAT_SPACE = 'chat space';
const DIRECT_SPACE = 'direct messages';

/* What an id in a room name stands for in the socket's own company: a project the person can read, or a chat
 * space (a main_chats row; the default one holds direct messages, the others hold channels). An id with nothing
 * behind it there is answered like a project they cannot open. */
const containerOf = async ({ companyId, uid }, id) => {
    if (!isId(id)) return null;
    const access = await canReadProject(companyId, uid, String(id));
    if (access.allowed) return PROJECT;
    if (access.missing !== true) return null;
    const space = await findById(companyId, SCHEMA_TYPE.MAIN_CHATS, id, { default: 1 });
    if (!space) return null;
    return space.default === true ? DIRECT_SPACE : CHAT_SPACE;
};

const canOpenChats = async (identity, spaceId) => Boolean(await containerOf(identity, spaceId));

const isPrivilegedHere = async ({ companyId, uid }) => isPrivileged(await getRoleType(companyId, uid));

/* The list a room names must be a list of the container it names. A name that carries no list id has no list
 * to hide; owners and admins read past a list's privacy, as they do over HTTP. */
const listVisible = async (identity, containerId, sprintId) => {
    if (!isId(sprintId)) return true;
    const sprint = await findById(identity.companyId, SCHEMA_TYPE.SPRINTS, sprintId, { private: 1, AssigneeUserId: 1, projectId: 1 });
    if (!sprint || String(sprint.projectId) !== String(containerId)) return false;
    if (await isPrivilegedHere(identity)) return true;
    return canSeeSprint(sprint, await sprintIdentities(identity.companyId, identity.uid));
};

const canOpenSprintBoard = async (identity, projectId, sprintId) => {
    if (!isId(projectId)) return false;
    const { companyId, uid } = identity;
    if (!(await canReadProject(companyId, uid, String(projectId))).allowed) return false;
    if (!(await mayListTasksIn(companyId, uid, String(projectId)))) return false;
    return listVisible(identity, projectId, sprintId);
};

const isParticipant = (task, uid) => [].concat(task.AssigneeUserId || []).map(String).includes(uid);

const TASK_ACCESS_FIELDS = { ProjectID: 1, sprintId: 1, mainChat: 1, AssigneeUserId: 1 };

/* The answer GET /api/v1/task/:id gives: a conversation belongs to the people in it and sits in a chat space,
 * every other row follows its project, the task-list rule and its list's privacy. */
const readsTask = async (identity, task) => {
    if (!task || !isId(task.ProjectID)) return false;
    if (task.mainChat === true && !isParticipant(task, identity.uid)) return false;
    const container = await containerOf(identity, task.ProjectID);
    if (container !== PROJECT) return Boolean(container) && task.mainChat === true;
    if (!(await mayListTasksIn(identity.companyId, identity.uid, String(task.ProjectID)))) return false;
    return (await isPrivilegedHere(identity)) || canSeeSprintById(identity.companyId, identity.uid, task.sprintId);
};

const canOpenTask = async (identity, taskId) => isId(taskId)
    && readsTask(identity, await findById(identity.companyId, SCHEMA_TYPE.TASKS, taskId, TASK_ACCESS_FIELDS));

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

/* A thread is named by its container, its list and its task. With a task id the task decides, and it must sit in
 * the named container; without one the room is a list's own thread, which in a chat space is a channel. */
const canOpenThread = async (identity, containerId, sprintId, taskId) => {
    if (isId(taskId)) {
        const task = await findById(identity.companyId, SCHEMA_TYPE.TASKS, taskId, TASK_ACCESS_FIELDS);
        return Boolean(task) && String(task.ProjectID) === String(containerId) && readsTask(identity, task);
    }
    const container = await containerOf(identity, containerId);
    if (container === PROJECT) {
        return (await mayListTasksIn(identity.companyId, identity.uid, String(containerId))) && listVisible(identity, containerId, sprintId);
    }
    return container === CHAT_SPACE && isId(sprintId) && listVisible(identity, containerId, sprintId);
};

const canOpenComments = async (identity, prefix) => {
    const doc = PAGE_COMMENT_ROOM.exec(prefix);
    if (doc) return Boolean(await readablePage(identity, doc[1]));
    const project = COMMENT_PROJECT_ROOM.exec(prefix);
    if (project) return [PROJECT, CHAT_SPACE].includes(await containerOf(identity, project[1]));
    const thread = COMMENT_TASK_ROOM.exec(prefix);
    return Boolean(thread) && canOpenThread(identity, thread[1], thread[2], thread[3]);
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

const VERDICT_TTL_MS = 10 * 1000;
const VERDICT_WAIT_MS = 5 * 1000;
const REMEMBERED_VERDICTS = 5000;
const verdicts = new Map();

/* Sends are queued behind their verdict, so a read that never answers must not hold every room: it counts as a refusal. */
const answeredInTime = (decide) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), VERDICT_WAIT_MS);
    Promise.resolve().then(decide).then(Boolean, () => false).then((allowed) => {
        clearTimeout(timer);
        resolve(allowed);
    });
});

/* A room outlives the access it was joined on: the person leaves the project, loses their seat, the list turns
 * private. So every send asks again, as the socket's own user in the socket's own company, and keeps the answer
 * for a few seconds so that a burst of events costs one read. */
const stillAllowed = (identity, subject, decide) => {
    const key = `${identity.companyId}:${identity.uid}:${subject}`;
    const now = Date.now();
    const known = verdicts.get(key);
    if (known && known.until > now) return known.allowed;
    if (verdicts.size >= REMEMBERED_VERDICTS) verdicts.clear();
    const allowed = answeredInTime(decide);
    verdicts.set(key, { allowed, until: now + VERDICT_TTL_MS });
    return allowed;
};

/* The writer names the company it wrote in. An event that names none is sent to nobody. */
const sameCompany = (identity, change) => Boolean(identity && change) && String(change.companyId || '') === identity.companyId;

const mayReceiveTask = (identity, change) => {
    const task = change && change.data;
    if (!task || !sameCompany(identity, change)) return false;
    if (task.mainChat === true && !isParticipant(task, identity.uid)) return false;
    const subject = `task:${task.ProjectID}:${task.sprintId}:${task.mainChat === true}`;
    return stillAllowed(identity, subject, () => readsTask(identity, task));
};

const mayReceiveComments = (identity, change, prefix) => {
    if (!sameCompany(identity, change)) return false;
    return stillAllowed(identity, `comments:${prefix}`, () => canOpenComments(identity, prefix));
};

const mayReceiveList = (identity, change) => sameCompany(identity, change)
    && stillAllowed(identity, `list:${change.projectId}:${change.sprintId}`, () => canOpenSprintBoard(identity, change.projectId, change.sprintId));

const mayReceiveCompany = (identity, companyId) => Boolean(identity) && identity.companyId === String(companyId || '')
    && stillAllowed(identity, 'seat', () => isCompanyMember(identity, identity.companyId));

/* A send waits for its verdict, so sends go out one after another: two changes to a row reach a room in the
 * order they were made. */
let sends = Promise.resolve();
const inOrder = (send) => {
    sends = sends.then(send).catch((error) => logger.error(`Socket relay failed: ${error.message || error}`));
    return sends;
};

module.exports = {
    identityOf,
    roomFor,
    prefixOfOwnRoom,
    isSelf,
    canOpenChats,
    canOpenTask,
    canOpenSprintBoard,
    canOpenComments,
    pageCommentRoomOf,
    readablePage,
    isCompanyMember,
    onJoin,
    sameCompany,
    mayReceiveTask,
    mayReceiveComments,
    mayReceiveList,
    mayReceiveCompany,
    inOrder,
    forgetVerdicts: () => verdicts.clear(),
};

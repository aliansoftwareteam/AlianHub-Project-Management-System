const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../utils/mongo-handler/objectIdKeys');
const tools = require('../Automations/engine/tools');
const permissions = require('./permissions');
const { asRoute, liveTask, storedProject, whoOf } = require('./taskRequests');
const { runAs, byline } = require('./actingAgent');
const { answerOf } = require('./pageRequests');
const { RELATION_TYPE_LIST } = require('../Tasks/helpers/taskMongo/relationRules');
const { MAX_MESSAGE_LENGTH } = require('../Pages/helpers/pageComments');
const { MAX_EXTRA_LISTS } = require('../Tasks/helpers/taskExtraListsRules');

// Tags, task links, lists, the lists a task is added to and doc comments an agent changes the way a person
// changes them: through the web app's own handlers, as the person behind the agent, after the checks the
// routes put in front of those handlers. The handlers are loaded on first use.

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const LIST_NAME_MAX = 100;
const TRASHED = 1;
const LIST_CREATE = 'project.project_sprint_create';
const LIST_RENAME = 'project.project_sprint_name_edit';
const LIST_MOVE = Object.freeze([LIST_RENAME, 'project.sprint_type_change', LIST_CREATE]);
const TASK_NOT_FOUND = 'Task not found';
const LIST_NOT_FOUND = 'That list was not found in that project. Check lists.list or ask the person which list they mean.';

const refuse = (message) => new tools.DeterministicError(message);
const idOf = (value) => (value === undefined || value === null ? '' : String(value));
const oid = (value) => new mongoose.Types.ObjectId(String(value));
const sprints = () => require('../Sprints/controller');
const pageComments = () => require('../Pages/comments');

const reasonOf = (answer, fallback) => [answer && answer.statusText, answer && answer.message].find((text) => typeof text === 'string' && text) || fallback;

const dataOf = async (handler, request, fallback) => {
    const answer = await answerOf(handler, request);
    if (!answer || answer.status !== true) throw refuse(reasonOf(answer, fallback));
    return answer.data || {};
};

/* The relation handlers reject with a plain error that carries the reason a person is shown. */
const withReason = async (run) => {
    try {
        return await run();
    } catch (error) {
        throw error instanceof tools.DeterministicError ? error : refuse(error.message);
    }
};

const tagsOf = (project) => (Array.isArray(project && project.tagsArray) ? project.tagsArray : []).filter((tag) => tag && tag.uid !== undefined && tag.uid !== null && tag.uid !== '');

const tagNamed = (tags, wanted) => {
    const text = idOf(wanted).trim();
    if (!text) return null;
    return tags.find((tag) => String(tag.uid) === text) || tags.find((tag) => String(tag.tagName || '').trim().toLowerCase() === text.toLowerCase()) || null;
};

const setTag = async ({ companyId, who, taskId, tag: wanted, operation }) => {
    const task = await liveTask(companyId, taskId);
    const tag = tagNamed(tagsOf(await storedProject(companyId, task.ProjectID)), wanted);
    if (!tag) throw refuse('That tag does not belong to this task\'s project. Check tags.list.');
    const held = (Array.isArray(task.tagsArray) ? task.tagsArray : []).map(String).includes(String(tag.uid));
    const changed = held !== (operation === 'add');
    if (changed) await asRoute(companyId, who, 'updateTags', { companyId: String(companyId), taskId: idOf(task._id), tagId: tag.uid, operation });
    return {
        result: { tagId: String(tag.uid), name: tag.tagName || '', changed },
        undo: changed ? { kind: 'tag', taskId: idOf(task._id), tagId: String(tag.uid), operation } : null,
        entityId: task._id, entityName: task.TaskName,
    };
};

/* The other end of a link answers as missing unless the person can open it, before anything says more about it. */
const openRelated = async (companyId, actor, action, relatedTaskId) => {
    const { readableTaskIds } = require('../Tasks/helpers/taskWritePlacement');
    const id = idOf(relatedTaskId);
    if (!(await readableTaskIds(companyId, whoOf(actor).uid, [id])).includes(id)) throw refuse(TASK_NOT_FOUND);
    const may = await permissions.holderMay(companyId, actor, action, { taskId: id });
    if (!may.allowed) throw refuse(may.reason);
    return id;
};

const linkTasks = ({ companyId, who, taskId, relatedTaskId, type }) => {
    if (!RELATION_TYPE_LIST.includes(type)) throw refuse(`The link type must be one of ${RELATION_TYPE_LIST.join(', ')}.`);
    return withReason(() => asRoute(companyId, who, 'addTaskRelation', { companyId: String(companyId), taskId: idOf(taskId), relatedTaskId: idOf(relatedTaskId), type }));
};

const unlinkTasks = ({ companyId, who, taskId, relatedTaskId }) => withReason(() => asRoute(companyId, who, 'removeTaskRelation', {
    companyId: String(companyId), taskId: idOf(taskId), relatedTaskId: idOf(relatedTaskId),
}));

/* A task's links as the relations route answers them to `uid`, which leaves out whole a link to a task that
 * person cannot open; null where the route answers that there is no such task. */
const relationsOf = async (companyId, uid, taskId) => {
    try {
        const answer = await asRoute(companyId, { uid: idOf(uid), via: '' }, 'getTaskRelations', { companyId: String(companyId), taskId: idOf(taskId) });
        return Array.isArray(answer && answer.data) ? answer.data : [];
    } catch (error) {
        if (/^task not found\.?$/i.test(String(error && error.message))) return null;
        throw error;
    }
};

const actingAs = async (who) => {
    const person = await require('../Sprints/helpers/actingUser').actingUser({ uid: who.uid });
    if (!person) throw refuse('This change has to be made for a person. Ask the person to connect you again.');
    return who.via ? { ...person, Employee_Name: byline(who.via, person.Employee_Name) } : person;
};

/* A list handler run as `who`: an agent's change carries its mark into the history and the events it writes. */
const listWrite = (who, handler, request, fallback) => runAs(who.mark, () => dataOf(handler, request, fallback));

/* What the list routes ask before a write: the project open for writing to this person, under the keys the route names. */
const mayWriteLists = async (companyId, uid, projectId, keys) => {
    const access = await require('../../Config/projectAccess').canEditProject(companyId, uid, projectId, keys);
    if (access.allowed) return;
    if (access.statusCode === 404) throw refuse('That project was not found. Ask the person which project they mean.');
    throw refuse(`${permissions.REASON}: ${access.permission || 'writing in this project'} is not allowed for the person you act for. Tell the person, and ask them to change it in AlianHub or do it themselves.`);
};

const listName = (value) => {
    const name = typeof value === 'string' ? value.trim() : '';
    if (!name || name.length > LIST_NAME_MAX) throw refuse(`The name must be between 1 and ${LIST_NAME_MAX} characters.`);
    return name;
};

const folderOf = (value) => {
    const id = idOf(value);
    if (id && !OBJECT_ID.test(id)) throw refuse('Give the id of a folder (see lists.list).');
    return id;
};

const openList = async (companyId, uid, projectId, sprintId) => {
    const list = await require('../Tasks/helpers/taskWritePlacement').listOf(companyId, uid, idOf(projectId), idOf(sprintId));
    if (!list) throw refuse(LIST_NOT_FOUND);
    if (Number(list.deletedStatusKey) > 0) throw refuse('This list is archived. Restore it first, then change it.');
    return list;
};

const listTarget = async ({ companyId, who, projectId, sprintId }, keys) => {
    const project = await storedProject(companyId, projectId);
    const list = await openList(companyId, who.uid, project._id, sprintId);
    await mayWriteLists(companyId, who.uid, idOf(project._id), keys);
    return { project, list, projectId: idOf(project._id), sprintId: idOf(list._id) };
};

const updateList = async ({ companyId, who, at, set, history }, fallback) => listWrite(who, sprints().updateSprint, {
    companyId, uid: who.uid, params: { id: at.sprintId },
    body: {
        type: 'updateSprint', companyId: String(companyId), projectId: at.projectId, folderId: idOf(at.list.folderId) || null,
        updateObject: { $set: set }, sprintName: at.list.name || '', projectData: { id: at.projectId, ProjectName: at.project.ProjectName || '' },
        folderName: at.list.folderName || '', ...(history ? { historyData: history } : {}), userData: await actingAs(who),
    },
}, fallback);

const createList = async ({ companyId, who, projectId, name, folderId }) => {
    const project = await storedProject(companyId, projectId);
    const inProject = idOf(project._id);
    await mayWriteLists(companyId, who.uid, inProject, [LIST_CREATE]);
    const folder = folderOf(folderId);
    const created = await listWrite(who, sprints().addSprint, {
        companyId, uid: who.uid,
        body: { companyId: String(companyId), projectId: inProject, sprintName: listName(name), userData: await actingAs(who), ...(folder ? { folder: { folderId: folder } } : {}) },
    }, 'the list was not created');
    return { projectId: inProject, sprintId: idOf(created._id), name: created.name || '', folderId: idOf(created.folderId) };
};

const renameList = async ({ companyId, who, projectId, sprintId, name }) => {
    const at = await listTarget({ companyId, who, projectId, sprintId }, [LIST_RENAME]);
    const wanted = listName(name);
    const previous = at.list.name || '';
    if (previous === wanted) return { ...at, previous, changed: false };
    await listWrite(who, sprints().editSprintName, {
        companyId, uid: who.uid, params: { id: at.sprintId },
        body: { companyId: String(companyId), projectId: at.projectId, sprintName: wanted, userData: await actingAs(who) },
    }, 'the list was not renamed');
    return { ...at, previous, name: wanted, changed: true };
};

const moveList = async ({ companyId, who, projectId, sprintId, folderId }) => {
    const at = await listTarget({ companyId, who, projectId, sprintId }, [LIST_MOVE]);
    const from = idOf(at.list.folderId);
    const to = folderOf(folderId);
    if (from === to) throw refuse(to ? 'The list is already in that folder.' : 'The list is already at the top level.');
    const moved = await updateList({ companyId, who, at, set: { folderId: to || null, folderName: '' }, history: { type: 'moved' } }, 'the list was not moved');
    return { ...at, previous: from, folderId: idOf(moved.folderId) };
};

/* Taking back a list an agent created moves it to the trash, and only while nothing has been put in it. */
const withdrawList = async ({ companyId, who, projectId, sprintId }) => {
    const project = await storedProject(companyId, projectId);
    const list = await openList(companyId, who.uid, project._id, sprintId);
    const at = { project, list, projectId: idOf(project._id), sprintId: idOf(list._id) };
    const held = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS, data: [{ sprintId: { $in: idForms(at.sprintId) }, deletedStatusKey: { $ne: TRASHED } }, { _id: 1 }],
    }, 'findOne');
    if (held) throw refuse('The list has tasks in it now, so it was not removed. Move the tasks first, or ask the person to delete the list in AlianHub.');
    await updateList({ companyId, who, at, set: { deletedStatusKey: TRASHED } }, 'the list was not removed');
    return at;
};

const commentText = (value) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text || text.length > MAX_MESSAGE_LENGTH) throw refuse(`The text must be between 1 and ${MAX_MESSAGE_LENGTH} characters.`);
    return text;
};

const storedRow = (companyId, type, id, filter, fields) => (OBJECT_ID.test(idOf(id))
    ? MongoDbCrudOpration(companyId, { type, data: [{ _id: oid(id), ...filter }, fields] }, 'findOne')
    : null);

/* The lists a task was added to as the task route answers them to `uid`, each named only where that person can
 * open it; null where the route answers that there is no such task. */
const extraListsOf = async (companyId, uid, taskId) => {
    const answer = await answerOf(require('../Tasks/helpers/getTasksData').getTaskLists, { companyId, uid: idOf(uid), params: { id: idOf(taskId) } });
    return answer && answer.status === true && answer.data && Array.isArray(answer.data.extraLists) ? answer.data.extraLists : null;
};

/* Adding and removing are the task route's own, which judges the task at its home and the list on its own. A
 * project named beside the list must be the one it sits in; that is asked after the task and answered as the
 * route answers a list that is not there, so it says nothing of a task or a list the person cannot open. The
 * list's project is `listProjectId` throughout: an action's `projectId` is where it is filed and judged, and
 * for a task that is its home. */
const setExtraList = async ({ companyId, who, taskId, listProjectId, sprintId, operation }) => {
    const { readableTaskIds } = require('../Tasks/helpers/taskWritePlacement');
    const { LIST_NOT_FOUND: NO_LIST, NOT_IN_LIST } = require('../Tasks/helpers/taskExtraLists');
    const adding = operation === 'add';
    const id = idOf(taskId).toLowerCase();
    const listId = idOf(sprintId).toLowerCase();
    if (!(await readableTaskIds(companyId, who.uid, [id])).includes(id)) throw refuse(TASK_NOT_FOUND);
    const list = await storedRow(companyId, SCHEMA_TYPE.SPRINTS, listId, {}, { projectId: 1 });
    if (idOf(listProjectId) && idOf(list && list.projectId) !== idOf(listProjectId).toLowerCase()) throw refuse((adding ? NO_LIST : NOT_IN_LIST).reason);
    await asRoute(companyId, who, adding ? 'addToList' : 'removeFromList', { companyId: String(companyId), taskId: id, sprintId: listId });
    return { taskId: id, listProjectId: idOf(list && list.projectId), sprintId: listId };
};

const extraListChange = (operation) => async ({ companyId, actor, params, depth }) => {
    const at = await setExtraList({ companyId, who: whoOf(actor, depth), taskId: params.taskId, listProjectId: params.listProjectId, sprintId: params.sprintId, operation });
    const task = await liveTask(companyId, at.taskId);
    return {
        result: { taskId: at.taskId, projectId: at.listProjectId, sprintId: at.sprintId, [operation === 'add' ? 'added' : 'removed']: true },
        undo: { kind: 'extraList', ...at, operation }, entityId: task._id, entityName: task.TaskName,
    };
};

/* A doc's comments as the comments route answers them to `uid`, or null where that route answers that there is no such doc. */
const pageCommentsOf = async (companyId, uid, pageId) => {
    const answer = await answerOf(pageComments().listComments, { companyId, uid: idOf(uid), params: { id: idOf(pageId) } });
    return answer && answer.status === true && Array.isArray(answer.data) ? answer.data : null;
};

const postPageComment = async ({ companyId, actor, params }, parentId) => {
    const { uid } = whoOf(actor);
    const pageId = idOf(params.pageId);
    const created = await dataOf(pageComments().createComment, {
        companyId, uid, params: { id: pageId }, body: { message: commentText(params.text), ...(parentId ? { parentId: idOf(parentId) } : {}) },
    }, 'the comment was not saved');
    const page = await storedRow(companyId, SCHEMA_TYPE.PAGES, pageId, {}, { title: 1, ProjectID: 1 });
    const commentId = idOf(created._id);
    return {
        result: { commentId, pageId, ...(created.parentId ? { threadId: idOf(created.parentId) } : {}), mentioned: (created.mentionIds || []).map(String) },
        undo: { kind: 'pageComment', pageId, commentId, projectId: idOf(page && page.ProjectID) },
        entityType: 'page', entityId: pageId, entityName: (page && page.title) || '',
    };
};

const assignPageComment = ({ companyId, uid, pageId, commentId, assigneeId }) => dataOf(pageComments().assignComment, {
    companyId, uid: idOf(uid), params: { id: idOf(pageId), commentId: idOf(commentId) }, body: { assigneeId: idOf(assigneeId) },
}, 'the comment was not assigned');

const executors = {
    async 'task.tags.add'({ companyId, actor, params, depth }) {
        return setTag({ companyId, who: whoOf(actor, depth), taskId: params.taskId, tag: params.tag, operation: 'add' });
    },

    async 'task.tags.remove'({ companyId, actor, params, depth }) {
        return setTag({ companyId, who: whoOf(actor, depth), taskId: params.taskId, tag: params.tag, operation: 'remove' });
    },

    async 'task.relation.add'({ companyId, actor, params, depth }) {
        const who = whoOf(actor, depth);
        const task = await liveTask(companyId, params.taskId);
        const relatedTaskId = await openRelated(companyId, actor, 'task.relation.add', params.relatedTaskId);
        const type = idOf(params.type);
        await linkTasks({ companyId, who, taskId: task._id, relatedTaskId, type });
        return {
            result: { taskId: idOf(task._id), relatedTaskId, type },
            undo: { kind: 'relation', taskId: idOf(task._id), relatedTaskId }, entityId: task._id, entityName: task.TaskName,
        };
    },

    async 'task.relation.remove'({ companyId, actor, params, depth }) {
        const who = whoOf(actor, depth);
        const task = await liveTask(companyId, params.taskId);
        const relatedTaskId = await openRelated(companyId, actor, 'task.relation.remove', params.relatedTaskId);
        const link = (Array.isArray(task.relations) ? task.relations : []).find((entry) => idOf(entry && entry.taskId) === relatedTaskId);
        await unlinkTasks({ companyId, who, taskId: task._id, relatedTaskId });
        return {
            result: { taskId: idOf(task._id), relatedTaskId, removed: true },
            undo: link ? { kind: 'relationRemoved', taskId: idOf(task._id), relatedTaskId, type: link.type } : null, entityId: task._id, entityName: task.TaskName,
        };
    },

    'task.lists.add': extraListChange('add'),
    'task.lists.remove': extraListChange('remove'),

    async 'list.create'({ companyId, actor, params, depth }) {
        const made = await createList({ companyId, who: whoOf(actor, depth), projectId: params.projectId, name: params.name, folderId: params.folderId });
        return { result: made, undo: { kind: 'list', projectId: made.projectId, sprintId: made.sprintId }, entityType: 'sprint', entityId: made.sprintId, entityName: made.name };
    },

    async 'list.rename'({ companyId, actor, params, depth }) {
        const out = await renameList({ companyId, who: whoOf(actor, depth), projectId: params.projectId, sprintId: params.sprintId, name: params.name });
        return {
            result: { projectId: out.projectId, sprintId: out.sprintId, name: out.changed ? out.name : out.previous, changed: out.changed },
            undo: out.changed ? { kind: 'listName', projectId: out.projectId, sprintId: out.sprintId, previous: out.previous } : null,
            entityType: 'sprint', entityId: out.sprintId, entityName: out.previous,
        };
    },

    async 'list.move'({ companyId, actor, params, depth }) {
        const out = await moveList({ companyId, who: whoOf(actor, depth), projectId: params.projectId, sprintId: params.sprintId, folderId: params.folderId });
        return {
            result: { projectId: out.projectId, sprintId: out.sprintId, folderId: out.folderId },
            undo: { kind: 'listFolder', projectId: out.projectId, sprintId: out.sprintId, previous: out.previous },
            entityType: 'sprint', entityId: out.sprintId, entityName: out.list.name || '',
        };
    },

    async 'page.comment.create'(args) {
        return postPageComment(args, '');
    },

    async 'page.comment.reply'(args) {
        if (!OBJECT_ID.test(idOf(args.params.commentId))) throw refuse('Comment not found.');
        return postPageComment(args, args.params.commentId);
    },

    async 'page.comment.assign'({ companyId, actor, params }) {
        const { uid } = whoOf(actor);
        const pageId = idOf(params.pageId);
        const commentId = idOf(params.commentId);
        const before = await storedRow(companyId, SCHEMA_TYPE.PAGE_COMMENTS, commentId, { isDeleted: { $ne: true } }, { assigneeId: 1, pageId: 1 });
        const updated = await assignPageComment({ companyId, uid, pageId, commentId, assigneeId: params.assigneeId });
        const page = await storedRow(companyId, SCHEMA_TYPE.PAGES, pageId, {}, { title: 1, ProjectID: 1 });
        return {
            result: { commentId, pageId, assigneeId: idOf(updated.assigneeId) },
            undo: { kind: 'pageCommentAssign', pageId, commentId, previous: idOf(before && before.assigneeId), projectId: idOf(page && page.ProjectID) },
            entityType: 'page', entityId: pageId, entityName: (page && page.title) || '',
        };
    },

    ...require('./setupRequests').executors,
    ...require('./projectSetup').executors,
    ...require('./projectCreate').executors,
    ...require('./automationRequests').executors,
};

module.exports = {
    executors, tagsOf, setTag, linkTasks, unlinkTasks, relationsOf, createList, renameList, moveList, withdrawList, pageCommentsOf, assignPageComment,
    extraListsOf, setExtraList,
    RELATION_TYPE_LIST, LIST_NAME_MAX, COMMENT_MAX: MAX_MESSAGE_LENGTH, MAX_EXTRA_LISTS,
};

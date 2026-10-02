const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { HEX_ID } = require('../../../utils/mongo-handler/objectIdKeys');
const { canReadProject, canEditProject } = require('../../../Config/projectAccess');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');
const { canSeeSprint, sprintIdentities } = require('../../Sprints/helpers/sprintVisibility');
const { canReadTask } = require('./taskReadAccess');
const rules = require('./taskExtraListsRules');

/* A task is read only by people who can open its home, and an extra list never gives access to
 * it. So adding is judged twice, at the home and at the list, and nothing here widens a read:
 * whatever the caller cannot open answers exactly as if it were not there. */

const MOVE = 'task.task_move';
const DELETED = 1;
const HISTORY_KEY = 'Task_Extra_List';

const LIST_FIELDS = { name: 1, projectId: 1, private: 1, AssigneeUserId: 1, isScrum: 1, isBacklog: 1, deletedStatusKey: 1 };
const PROJECT_FIELDS = { ProjectName: 1, isPersonal: 1, statusType: 1, deletedStatusKey: 1 };

const TASK_NOT_FOUND = Object.freeze({ ok: false, statusCode: 404, code: 'TASK_NOT_FOUND', reason: 'Task not found' });
const LIST_NOT_FOUND = Object.freeze({ ok: false, statusCode: 404, code: 'LIST_NOT_FOUND', reason: 'List not found' });
const NOT_IN_LIST = Object.freeze({ ok: false, statusCode: 404, code: 'NOT_IN_LIST', reason: 'The task is not in that list.' });
const NOT_PERMITTED = Object.freeze({ ok: false, statusCode: 403, code: 'NOT_PERMITTED', reason: 'You do not have permission to perform this action.' });
const TASK_CHANGED = Object.freeze({ ok: false, statusCode: 409, code: 'TASK_CHANGED', reason: 'The task changed while it was being added. Try again.' });
const ALLOWED = Object.freeze({ ok: true });

const ruled = (verdict) => ({ ...verdict, statusCode: 400 });

const toObjectId = (id) => new mongoose.Types.ObjectId(String(id));
const sameId = (a, b) => String(a) === String(b);

const findById = async (companyId, type, id, fields = null) => (HEX_ID.test(String(id || ''))
    ? MongoDbCrudOpration(companyId, { type, data: [{ _id: toObjectId(id) }, fields, { lean: true }] }, 'findOne')
    : null);

const findByIds = async (companyId, type, ids, fields) => {
    const wanted = [...new Set(ids.map(String))].filter((id) => HEX_ID.test(id));
    if (!wanted.length) return new Map();
    const rows = await MongoDbCrudOpration(companyId, { type, data: [{ _id: { $in: wanted.map(toObjectId) } }, fields, { lean: true }] }, 'find');
    return new Map((rows || []).map((row) => [String(row._id), row]));
};

const storedTask = (companyId, taskId) => findById(companyId, SCHEMA_TYPE.TASKS, taskId);

const storedTasks = (companyId, taskIds) => findByIds(companyId, SCHEMA_TYPE.TASKS, taskIds, null);

/* Owners and admins read past sprint privacy, as everywhere else. */
const seesList = async (companyId, uid, list) => list.private !== true
    || isPrivileged(await getRoleType(companyId, uid))
    || canSeeSprint(list, await sprintIdentities(companyId, uid));

/* Judges whether a stored task may be given an extra list by this caller: readable at its home,
 * allowed by the rules, and movable there. Tasks of one request mostly share a home, so each
 * home is judged once. */
const homeJudge = (companyId, uid) => {
    const memo = new Map();
    const once = (key, read) => {
        if (!memo.has(key)) memo.set(key, read());
        return memo.get(key);
    };
    const readable = (task) => once(`read:${task.mainChat === true ? task._id : `${task.ProjectID}:${task.sprintId}`}`, () => canReadTask(companyId, uid, task));
    const homeOf = (task) => once(`home:${task.ProjectID}`, () => findById(companyId, SCHEMA_TYPE.PROJECTS, task.ProjectID, PROJECT_FIELDS));
    const movable = (task) => once(`move:${task.ProjectID}`, () => canEditProject(companyId, uid, String(task.ProjectID), [MOVE]));

    const read = async (task) => (task && task.deletedStatusKey !== DELETED && await readable(task) ? ALLOWED : TASK_NOT_FOUND);
    const hold = async (task) => {
        const seen = await read(task);
        if (!seen.ok) return seen;
        const fit = rules.canHoldExtraLists(task, await homeOf(task));
        if (!fit.ok) return ruled(fit);
        return (await movable(task)).allowed ? ALLOWED : NOT_PERMITTED;
    };
    return { read, hold, movable };
};

/* The list a task is to be added to, as this caller may use it. A list in a chat space has no
 * project behind it and is not there; a private sprint the caller is not on is not there either,
 * even for a role that lists every private project. */
const destinationFor = async (companyId, uid, sprintId) => {
    const list = await findById(companyId, SCHEMA_TYPE.SPRINTS, sprintId, LIST_FIELDS);
    if (!list || list.deletedStatusKey === DELETED) return LIST_NOT_FOUND;
    const project = await findById(companyId, SCHEMA_TYPE.PROJECTS, list.projectId, PROJECT_FIELDS);
    if (!project || project.deletedStatusKey === DELETED) return LIST_NOT_FOUND;
    const access = await canEditProject(companyId, uid, String(project._id), [MOVE]);
    if (!access.allowed && access.statusCode !== 403) return LIST_NOT_FOUND;
    if (!(await seesList(companyId, uid, list))) return LIST_NOT_FOUND;
    if (!access.allowed) return NOT_PERMITTED;
    const fit = rules.canBeExtraList(list, project);
    return fit.ok ? { ok: true, list, project } : ruled(fit);
};

/* The stored entry and whether this caller may take it away: by the right to move the task at
 * its home, or by the same right in the list's project when they can open that list. */
const removalFor = async (companyId, uid, task, sprintId) => {
    const judge = homeJudge(companyId, uid);
    const seen = await judge.read(task);
    if (!seen.ok) return seen;
    const entry = rules.entryFor(task, sprintId);
    if (!entry) return NOT_IN_LIST;
    const list = await findById(companyId, SCHEMA_TYPE.SPRINTS, entry.sprintId, LIST_FIELDS);
    if ((await judge.movable(task)).allowed) return { ok: true, entry, list };
    const managesList = Boolean(list) && sameId(list.projectId, entry.projectId)
        && (await canEditProject(companyId, uid, String(list.projectId), [MOVE])).allowed
        && await seesList(companyId, uid, list);
    return managesList ? { ok: true, entry, list } : NOT_PERMITTED;
};

/* The update that adds the entry only while the rules still hold, so two requests at once cannot
 * put a task in a list twice, past the cap, or into the list it has just been moved to. */
const additionOf = (task, { list, project }, uid, at = new Date()) => {
    const listId = toObjectId(list._id);
    return {
        filter: {
            _id: toObjectId(task._id),
            deletedStatusKey: 0,
            sprintId: { $ne: listId },
            $or: [{ ParentTaskId: null }, { ParentTaskId: '' }],
            $nor: [{ extraLists: { $elemMatch: { sprintId: listId } } }],
            [`extraLists.${rules.MAX_EXTRA_LISTS - 1}`]: { $exists: false },
        },
        update: { $push: { extraLists: { projectId: toObjectId(project._id), sprintId: listId, addedBy: String(uid), addedAt: at } } },
    };
};

const removalOf = (task, sprintId) => ({
    filter: { _id: toObjectId(task._id) },
    update: { $pull: { extraLists: { sprintId: toObjectId(sprintId) } } },
});

const pullOfLists = (sprintIds) => ({ extraLists: { sprintId: { $in: sprintIds.map(toObjectId) } } });

/* What a move of the task's home leaves of its extra lists. The new home is never one of them, and
 * the pull names it even when the row read here holds none, so an entry added meanwhile goes too.
 * When the project changes, an entry stays only where the rules still let that list hold the task;
 * a list in the trash keeps its entry, which shows again once the list is restored. */
const afterHomeMove = async (companyId, task, home) => {
    const entries = rules.extraListsOf(task).filter((entry) => !sameId(entry.sprintId, home.sprintId));
    if (!entries.length || sameId(task.ProjectID, home.projectId)) return { pull: pullOfLists([home.sprintId]), dropped: [] };
    const [lists, projects] = await Promise.all([
        findByIds(companyId, SCHEMA_TYPE.SPRINTS, entries.map((entry) => entry.sprintId), LIST_FIELDS),
        findByIds(companyId, SCHEMA_TYPE.PROJECTS, [home.projectId, ...entries.map((entry) => entry.projectId)], PROJECT_FIELDS),
    ]);
    const holds = rules.canHoldExtraLists({ mainChat: task.mainChat, ParentTaskId: task.ParentTaskId }, projects.get(String(home.projectId))).ok;
    const stays = (entry, list) => {
        const project = projects.get(String(entry.projectId));
        return holds && Boolean(list) && Boolean(project) && sameId(list.projectId, entry.projectId)
            && rules.canBeExtraList({ ...list, deletedStatusKey: 0 }, project).ok;
    };
    const dropped = entries
        .map((entry) => ({ entry: { projectId: String(entry.projectId), sprintId: String(entry.sprintId) }, list: lists.get(String(entry.sprintId)) || null }))
        .filter(({ entry, list }) => !stays(entry, list));
    return { pull: pullOfLists([home.sprintId, ...dropped.map(({ entry }) => entry.sprintId)]), dropped };
};

/* A task's extra lists as this viewer may see them. The ids are on the stored row, which every
 * reader of the task already gets; the list's name and its project's name are added only for a
 * live list the viewer can open. */
const viewerShape = async (companyId, uid, entries) => {
    const [lists, projects, privileged, identities] = await Promise.all([
        findByIds(companyId, SCHEMA_TYPE.SPRINTS, entries.map((entry) => entry.sprintId), LIST_FIELDS),
        findByIds(companyId, SCHEMA_TYPE.PROJECTS, entries.map((entry) => entry.projectId), PROJECT_FIELDS),
        getRoleType(companyId, uid).then(isPrivileged),
        sprintIdentities(companyId, uid),
    ]);
    const readable = new Map();
    for (const id of projects.keys()) readable.set(id, (await canReadProject(companyId, uid, id)).allowed);

    return (entry) => {
        const list = lists.get(String(entry.sprintId));
        const project = projects.get(String(entry.projectId));
        const open = Boolean(list) && Boolean(project) && sameId(list.projectId, entry.projectId)
            && !list.deletedStatusKey && !project.deletedStatusKey
            && readable.get(String(entry.projectId)) === true
            && (privileged || canSeeSprint(list, identities));
        return {
            projectId: String(entry.projectId),
            sprintId: String(entry.sprintId),
            addedBy: entry.addedBy || '',
            addedAt: entry.addedAt || null,
            ...(open ? { name: list.name || '', projectName: project.ProjectName || '' } : {}),
        };
    };
};

const listsForViewer = async (companyId, uid, task) => {
    const entries = rules.extraListsOf(task);
    return entries.length ? entries.map(await viewerShape(companyId, uid, entries)) : [];
};

/* The same for a page of rows, read once for all of them: task id to its lists, for the rows that have any. */
const listsForViewerOf = async (companyId, uid, tasks) => {
    const held = (tasks || []).filter((task) => rules.extraListsOf(task).length);
    if (!held.length) return new Map();
    const shape = await viewerShape(companyId, uid, held.flatMap((task) => rules.extraListsOf(task)));
    return new Map(held.map((task) => [String(task._id), rules.extraListsOf(task).map(shape)]));
};

/* Whether the caller may look at this list at all: it is there, in a project whose tasks their role
 * may list, and not a private sprint they are outside of. A task's row is shown under a list it was
 * added to only when this holds, on top of the rule of the task's own home. */
const opensList = async (companyId, uid, sprintId) => {
    const list = await findById(companyId, SCHEMA_TYPE.SPRINTS, sprintId, LIST_FIELDS);
    if (!list || list.deletedStatusKey === DELETED) return false;
    return canReadTask(companyId, uid, { ProjectID: list.projectId, sprintId: list._id });
};

/* How a history line may name the list: by name only when it sits in the task's own project and
 * is not private, because everyone who can read the task reads its history. */
const listPhrase = (task, entry, list, escape) => {
    if (!sameId(entry.projectId, task.ProjectID)) return 'a list in another project';
    if (!list) return 'a list';
    if (list.private === true) return 'a private list';
    return `the list <b>${escape(list.name || '')}</b>`;
};

module.exports = {
    ...rules,
    MOVE, HISTORY_KEY, TASK_NOT_FOUND, LIST_NOT_FOUND, NOT_IN_LIST, NOT_PERMITTED, TASK_CHANGED,
    storedTask, storedTasks, homeJudge, destinationFor, removalFor, additionOf, removalOf, pullOfLists, afterHomeMove, listsForViewer, listsForViewerOf, opensList, listPhrase,
};

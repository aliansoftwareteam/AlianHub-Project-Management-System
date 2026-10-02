const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../utils/mongo-handler/objectIdKeys');
const registry = require('../Agents/registry');
const { oid } = require('../Automations/engine/tools');
const work = require('../Agents/workRequests');
const { opensList } = require('../Tasks/helpers/taskExtraLists');
const { TASK_ACCESS_FIELDS } = require('./visibility');
const { GRANT, DOCS_GRANT } = require('./manageFlag');
const { loadProject, NO_PROJECT, NO_TASK, NO_PAGE } = require('./dataTools');
const { taskRow } = require('./taskRows');
const goalTools = require('./goalTools');
const setupTools = require('./setupTools');
const automationTools = require('./automationTools');
const dashboardTools = require('./dashboardTools');
const queueTools = require('./queueTools');
const v2 = require('./v2Flag');
const cursor = require('./cursor');

// Everyday work on what a person can already open: tags, links between tasks, lists, the lists a task is added to and doc comments.
// A read needs the read scope and a write the write scope, with no grant. Each write names its target so
// tools.call checks it against the caller's filter first, then runs as a registry action whose executor is
// the web route's own handler (Modules/Agents/workRequests.js).

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const ROWS_MAX = 200;
const TAG_MAX = 120;

const isId = (v) => OBJECT_ID.test(String(v || ''));
const idOf = (v) => (v === undefined || v === null ? '' : String(v));
const str = (v, max = 500) => String(v === undefined || v === null ? '' : v).slice(0, max);
const find = (ctx, type, filter, fields, options) => MongoDbCrudOpration(ctx.companyId, { type, data: [filter, fields || null, options] }, 'find');
const findOne = (ctx, type, filter, fields) => MongoDbCrudOpration(ctx.companyId, { type, data: [filter, fields || null] }, 'findOne');

const ID = Object.freeze({ type: 'string', pattern: '^[a-fA-F0-9]{24}$' });
const ID_OR_NONE = Object.freeze({ type: ['string', 'null'], pattern: '^[a-fA-F0-9]{24}$' });
const REASON = Object.freeze({ reason: { type: 'string', maxLength: 500, description: 'Why, in a line; it is kept in the audit log' } });
const input = (properties, required) => ({ type: 'object', additionalProperties: false, properties, required });

const taskTarget = (args) => ({ taskId: str(args.taskId, 40) });
const linkTarget = (args) => ({ taskId: str(args.taskId, 40), relatedTaskId: str(args.relatedTaskId, 40) });
const listTarget = (args) => ({ projectId: str(args.projectId, 40), sprintId: str(args.sprintId, 40) });
const pageTarget = (args) => ({ pageId: str(args.pageId, 40) });
const taskInList = (args) => ({ taskId: str(args.taskId, 40), projectId: str(args.projectId, 40), sprintId: str(args.sprintId, 40) });
/* The list's project is not the action's `projectId`: the action is filed and judged at the task's home. */
const taskInListParams = (args) => ({ taskId: str(args.taskId, 40), listProjectId: str(args.projectId, 40), sprintId: str(args.sprintId, 40) });
const projectParams = (args) => (isId(args.projectId) ? { projectId: String(args.projectId) } : {});

const MENTIONS = 'To mention a member so they are notified, write @[Their Name](their member id).';
const LIST_NAME = Object.freeze({ type: 'string', minLength: 1, maxLength: work.LIST_NAME_MAX });
const COMMENT_TEXT = Object.freeze({ type: 'string', minLength: 1, maxLength: work.COMMENT_MAX });
const TAG = Object.freeze({ type: 'string', minLength: 1, maxLength: TAG_MAX, description: 'A tag id or name from tags.list' });

const tagRow = (tag) => ({ tagId: String(tag.uid), name: tag.tagName || '', color: tag.tagColor || '' });

const LINKED_TASK = Object.freeze(['taskId', 'key', 'title', 'status', 'statusType', 'priority', 'projectId', 'sprintId', 'dueDate']);

const relationRow = (link) => {
    const row = taskRow(link.task);
    return { type: link.type, label: link.label || link.type, task: Object.fromEntries(LINKED_TASK.map((field) => [field, row[field]])), linkedBy: idOf(link.createdBy), linkedAt: link.createdAt || null };
};

const extraListRow = (list) => ({
    projectId: idOf(list.projectId), sprintId: idOf(list.sprintId), name: list.name || '', project: list.projectName || '', addedBy: idOf(list.addedBy), addedAt: list.addedAt || null,
});

const folderRow = (folder) => ({ folderId: String(folder._id), name: folder.name || '', parentFolderId: idOf(folder.parentFolderId) });

const listRow = (folders) => (list) => {
    const folder = folders.get(idOf(list.folderId)) || null;
    const parent = folder ? folders.get(idOf(folder.parentFolderId)) || null : null;
    return {
        sprintId: String(list._id), name: list.name || '', private: list.private === true, sprint: list.isScrum === true,
        folderId: folder ? String(folder._id) : '', folder: folder ? folder.name || '' : '',
        parentFolderId: parent ? String(parent._id) : '', parentFolder: parent ? parent.name || '' : '',
    };
};

const pageCommentRow = (comment) => ({
    commentId: String(comment._id),
    text: comment.message || '',
    authorId: idOf(comment.userId),
    threadId: idOf(comment.parentId),
    blockId: comment.blockId || '',
    assigneeId: idOf(comment.assigneeId),
    resolved: comment.resolved === true,
    file: comment.mediaOriginalName || '',
    createdAt: comment.createdAt || null,
    editedAt: comment.editedAt || null,
});

const LIVE = Object.freeze({ $in: [0, null] });

const OTHER_LIST = Object.freeze({ ...ID, description: 'The other list (see lists.list)' });
const LIST_PROJECT = Object.freeze({ ...ID, description: 'The project that list is in' });
const SEARCH_INPUT = Object.freeze({ sprintId: { type: 'string', description: 'Only the tasks of this list: the ones that live in it and the ones added to it' } });

/* What tasks.search adds for one list: the tasks that live in it and, for a caller who can open the list, the
 * tasks added to it. It goes beside the caller's own clause, so a task is still read by its home alone. */
const listRows = async (ctx, vis, sprintId) => {
    if (!isId(sprintId)) return { error: 'sprintId must be a list id' };
    const ids = idForms(String(sprintId));
    const home = { sprintId: { $in: ids } };
    const list = await findOne(ctx, SCHEMA_TYPE.SPRINTS, { _id: oid(String(sprintId)) }, { projectId: 1 });
    const open = Boolean(list) && vis.allowsProject(list.projectId) && vis.allowsSprint(list._id) && await opensList(ctx.companyId, ctx.userId, String(sprintId));
    return { filter: open ? { $or: [home, { extraLists: { $elemMatch: { sprintId: { $in: ids } } } }] } : home };
};

const TOOLS = [
    {
        name: 'tags.list',
        action: 'tags.list',
        description: 'The tags one project defines: id, name and colour. Put one on a task with task.tags.add.',
        input: input({ projectId: ID }, ['projectId']),
        visibility: 'filtered',
        strict: true,
        readParams: projectParams,
        run: async (ctx, args, vis) => {
            const project = await loadProject(ctx, vis, args.projectId);
            if (!project) return { ...NO_PROJECT };
            return { projectId: String(project._id), tags: work.tagsOf(project).slice(0, ROWS_MAX).map(tagRow) };
        },
    },
    {
        name: 'task.relations.list',
        action: 'task.relations.list',
        description: 'The tasks a task is linked to, each with how: blocks, blocked_by, duplicates, duplicated_by or relates_to. Only linked tasks you can open are listed.',
        input: input({ taskId: ID }, ['taskId']),
        visibility: 'filtered',
        strict: true,
        run: async (ctx, args, vis) => {
            const task = await findOne(ctx, SCHEMA_TYPE.TASKS, { _id: oid(String(args.taskId)), deletedStatusKey: { $ne: 1 } }, TASK_ACCESS_FIELDS);
            if (!vis.allowsTask(task)) return { ...NO_TASK };
            const links = await work.relationsOf(ctx.companyId, ctx.userId, task._id);
            if (!links) return { ...NO_TASK };
            // The route keeps what the person can open; the token's own project list narrows it once more.
            const open = links.filter((link) => link.task && Number(link.task.deletedStatusKey) !== 1 && vis.allowsTask(link.task));
            return { taskId: String(task._id), relations: open.map(relationRow) };
        },
    },
    {
        name: 'task.lists.list',
        action: 'task.lists.list',
        description: 'The lists a task was added to beside its home list, which is the sprintId the task carries. Only lists you can open are listed.',
        input: input({ taskId: ID }, ['taskId']),
        visibility: 'filtered',
        strict: true,
        run: async (ctx, args, vis) => {
            const task = await findOne(ctx, SCHEMA_TYPE.TASKS, { _id: oid(String(args.taskId)), deletedStatusKey: { $ne: 1 } }, TASK_ACCESS_FIELDS);
            if (!vis.allowsTask(task)) return { ...NO_TASK };
            const lists = await work.extraListsOf(ctx.companyId, ctx.userId, task._id);
            if (!lists) return { ...NO_TASK };
            // The route names a list only for a person who can open it; the token's own project list narrows it once more.
            const open = lists.filter((list) => list.name !== undefined && vis.allowsProject(list.projectId) && vis.allowsSprint(list.sprintId));
            return { taskId: String(task._id), lists: open.map(extraListRow) };
        },
    },
    {
        name: 'lists.list',
        action: 'lists.list',
        description: 'The live lists of one project with the folder and parent folder each sits in, and the project\'s folders. A private list is listed only for the people on it, and for owners and admins.',
        input: input({ projectId: ID }, ['projectId']),
        visibility: 'filtered',
        strict: true,
        readParams: projectParams,
        run: async (ctx, args, vis) => {
            const project = await loadProject(ctx, vis, args.projectId);
            if (!project) return { ...NO_PROJECT };
            const projectId = String(project._id);
            const inProject = { projectId: { $in: idForms(projectId) }, deletedStatusKey: LIVE };
            const hidden = vis.hiddenSprintIds.map(String).filter(isId);
            const [folders, lists] = await Promise.all([
                find(ctx, SCHEMA_TYPE.FOLDERS, inProject, { name: 1, parentFolderId: 1 }, { sort: { _id: 1 }, limit: ROWS_MAX }),
                find(ctx, SCHEMA_TYPE.SPRINTS, { ...inProject, ...(hidden.length ? { _id: { $nin: hidden.map(oid) } } : {}) }, null, { sort: { _id: 1 }, limit: ROWS_MAX }),
            ]);
            const byId = new Map((folders || []).map((folder) => [String(folder._id), folder]));
            return { projectId, folders: (folders || []).map(folderRow), lists: (lists || []).map(listRow(byId)) };
        },
    },
    {
        name: 'page.comments.list',
        action: 'page.comments.list',
        description: 'The comments on a doc you can open, oldest first. A reply names its thread in threadId.',
        input: input({ pageId: ID, limit: { type: 'integer', minimum: 1, maximum: cursor.PAGE_MAX } }, ['pageId']),
        visibility: 'filtered',
        strict: true,
        paginated: true,
        readParams: () => ({}),
        run: async (ctx, args, vis) => {
            const page = await findOne(ctx, SCHEMA_TYPE.PAGES, { _id: oid(String(args.pageId)), deletedStatusKey: { $ne: 1 } }, { ProjectID: 1, visibility: 1, createdBy: 1 });
            if (!page || !vis.allowsPage(page)) return { ...NO_PAGE };
            const all = await work.pageCommentsOf(ctx.companyId, ctx.userId, page._id);
            if (!all) return { ...NO_PAGE };
            const slice = ({ skip, limit }) => all.slice(skip, skip + limit).map(pageCommentRow);
            const { rows, nextCursor } = v2.enabled()
                ? await cursor.page(ctx, 'page.comments.list', args, slice)
                : { rows: slice({ skip: 0, limit: cursor.pageSize(args.limit) }) };
            return { pageId: String(page._id), comments: rows, ...(nextCursor ? { nextCursor } : {}) };
        },
    },
    {
        name: 'task.tags.add',
        action: 'task.tags.add',
        visibility: 'filtered',
        strict: true,
        target: taskTarget,
        description: 'Put one of the project\'s tags on a task, by tag id or by name (see tags.list).',
        input: input({ taskId: ID, tag: TAG, ...REASON }, ['taskId', 'tag']),
        params: (args) => ({ taskId: str(args.taskId, 40), tag: str(args.tag, TAG_MAX) }),
    },
    {
        name: 'task.tags.remove',
        action: 'task.tags.remove',
        visibility: 'filtered',
        strict: true,
        target: taskTarget,
        description: 'Take a tag off a task, by tag id or by name.',
        input: input({ taskId: ID, tag: TAG, ...REASON }, ['taskId', 'tag']),
        params: (args) => ({ taskId: str(args.taskId, 40), tag: str(args.tag, TAG_MAX) }),
    },
    {
        name: 'task.relation.add',
        action: 'task.relation.add',
        visibility: 'filtered',
        strict: true,
        filedUnder: GRANT,
        target: linkTarget,
        description: 'Link a task to another task you can open. The type reads from the first task: it blocks, is blocked_by, duplicates, is duplicated_by or relates_to the other. The other task shows the matching link. One link per pair of tasks.',
        input: input({ taskId: ID, relatedTaskId: ID, type: { type: 'string', enum: [...work.RELATION_TYPE_LIST] }, ...REASON }, ['taskId', 'relatedTaskId', 'type']),
        params: (args) => ({ taskId: str(args.taskId, 40), relatedTaskId: str(args.relatedTaskId, 40), type: str(args.type, 20) }),
    },
    {
        name: 'task.relation.remove',
        action: 'task.relation.remove',
        visibility: 'filtered',
        strict: true,
        filedUnder: GRANT,
        target: linkTarget,
        description: 'Remove the link between two tasks you can open, on both of them.',
        input: input({ taskId: ID, relatedTaskId: ID, ...REASON }, ['taskId', 'relatedTaskId']),
        params: (args) => ({ taskId: str(args.taskId, 40), relatedTaskId: str(args.relatedTaskId, 40) }),
    },
    {
        name: 'task.lists.add',
        action: 'task.lists.add',
        visibility: 'filtered',
        strict: true,
        filedUnder: GRANT,
        target: taskInList,
        description: `Add a top-level task to another list you can open, in its own project or another one. It stays in its home list and keeps that project's statuses; its subtasks show under it. Not a Scrum sprint, a backlog or a personal list, and at most ${work.MAX_EXTRA_LISTS} lists per task. You need to be able to move tasks in the task's project and in the list's.`,
        input: input({ taskId: ID, projectId: LIST_PROJECT, sprintId: OTHER_LIST, ...REASON }, ['taskId', 'projectId', 'sprintId']),
        params: taskInListParams,
    },
    {
        name: 'task.lists.remove',
        action: 'task.lists.remove',
        visibility: 'filtered',
        strict: true,
        filedUnder: GRANT,
        target: taskInList,
        description: 'Take a task out of a list it was added to (see task.lists.list). It stays in its home list, which this never changes.',
        input: input({ taskId: ID, projectId: LIST_PROJECT, sprintId: OTHER_LIST, ...REASON }, ['taskId', 'projectId', 'sprintId']),
        params: taskInListParams,
    },
    {
        name: 'list.create',
        action: 'list.create',
        visibility: 'filtered',
        strict: true,
        filedUnder: GRANT,
        target: (args) => ({ projectId: str(args.projectId, 40) }),
        description: 'Create a list in a project, at the top level or in one of the project\'s folders or subfolders (see lists.list).',
        input: input({ projectId: ID, name: LIST_NAME, folderId: { ...ID, description: 'The folder or subfolder to create it in' }, ...REASON }, ['projectId', 'name']),
        params: (args) => ({ projectId: str(args.projectId, 40), name: str(args.name, work.LIST_NAME_MAX), ...(args.folderId !== undefined ? { folderId: str(args.folderId, 40) } : {}) }),
    },
    {
        name: 'list.rename',
        action: 'list.rename',
        visibility: 'filtered',
        strict: true,
        filedUnder: GRANT,
        target: listTarget,
        description: 'Rename a list.',
        input: input({ projectId: ID, sprintId: { ...ID, description: 'The list (see lists.list)' }, name: LIST_NAME, ...REASON }, ['projectId', 'sprintId', 'name']),
        params: (args) => ({ projectId: str(args.projectId, 40), sprintId: str(args.sprintId, 40), name: str(args.name, work.LIST_NAME_MAX) }),
    },
    {
        name: 'list.move',
        action: 'list.move',
        visibility: 'filtered',
        strict: true,
        filedUnder: GRANT,
        target: listTarget,
        description: 'Move a list into a folder or subfolder of its own project, or to the top level with folderId null. Its tasks go with it.',
        input: input({ projectId: ID, sprintId: { ...ID, description: 'The list (see lists.list)' }, folderId: { ...ID_OR_NONE, description: 'The folder to move it into; null for the top level' }, ...REASON }, ['projectId', 'sprintId', 'folderId']),
        params: (args) => ({ projectId: str(args.projectId, 40), sprintId: str(args.sprintId, 40), folderId: args.folderId === null ? '' : str(args.folderId, 40) }),
    },
    {
        name: 'page.comment.create',
        action: 'page.comment.create',
        visibility: 'filtered',
        strict: true,
        filedUnder: DOCS_GRANT,
        target: pageTarget,
        description: `Comment on a doc you can open. The text is stored as plain text, as the web app stores it. ${MENTIONS}`,
        input: input({ pageId: ID, text: COMMENT_TEXT, ...REASON }, ['pageId', 'text']),
        params: (args) => ({ pageId: str(args.pageId, 40), text: str(args.text, work.COMMENT_MAX) }),
    },
    {
        name: 'page.comment.reply',
        action: 'page.comment.reply',
        visibility: 'filtered',
        strict: true,
        filedUnder: DOCS_GRANT,
        target: pageTarget,
        description: `Reply to a comment on a doc you can open; a reply to a reply joins the same thread. ${MENTIONS}`,
        input: input({ pageId: ID, commentId: ID, text: COMMENT_TEXT, ...REASON }, ['pageId', 'commentId', 'text']),
        params: (args) => ({ pageId: str(args.pageId, 40), commentId: str(args.commentId, 40), text: str(args.text, work.COMMENT_MAX) }),
    },
    {
        name: 'page.comment.assign',
        action: 'page.comment.assign',
        visibility: 'filtered',
        strict: true,
        filedUnder: DOCS_GRANT,
        target: pageTarget,
        description: 'Assign a comment thread on a doc to an active member who can read the doc, or clear it with assigneeId null. Only the people on the comment or an admin may change who holds it.',
        input: input({ pageId: ID, commentId: ID, assigneeId: { ...ID_OR_NONE, description: 'A member id; null clears it' }, ...REASON }, ['pageId', 'commentId', 'assigneeId']),
        params: (args) => ({ pageId: str(args.pageId, 40), commentId: str(args.commentId, 40), assigneeId: args.assigneeId === null ? '' : str(args.assigneeId, 40) }),
    },
    ...goalTools.TOOLS,
    ...setupTools.TOOLS,
    ...automationTools.TOOLS,
    ...dashboardTools.TOOLS,
    ...queueTools.TOOLS,
];

/* OAuth has no write scope for projects or docs, so each write is held to the one a comment or a task change needs. */
const SCOPES = Object.freeze({
    'tags.list': 'projects:read',
    'lists.list': 'projects:read',
    'task.relations.list': 'tasks:read',
    'task.lists.list': 'tasks:read',
    'page.comments.list': 'docs:read',
    ...goalTools.READ_SCOPES,
    ...queueTools.READ_SCOPES,
    ...automationTools.READ_SCOPES,
    ...Object.fromEntries(TOOLS.filter((tool) => !tool.run).map((tool) => [tool.name, 'tasks:write'])),
});

const offered = () => TOOLS.filter((tool) => registry.has(tool.action));

/* The manage grant a held call of this action is filed under for an outside client, which approval asks again. */
const filedUnder = (action) => {
    const tool = TOOLS.find((candidate) => candidate.action === String(action));
    return (tool && tool.filedUnder) || null;
};

module.exports = { TOOLS, SCOPES, SEARCH_INPUT, offered, filedUnder, listRows };

const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const registry = require('../Agents/registry');
const actions = require('../Agents/actions');
const { oid } = require('../Automations/engine/tools');
const { buildBrief } = require('./brief');

const str = (v, max = 500) => String(v === undefined || v === null ? '' : v).slice(0, max);
const clampLimit = (v, def = 10, max = 50) => Math.min(Math.max(parseInt(v, 10) || def, 1), max);

const scopeFilter = (ctx, extra = {}) => {
    const filter = { CompanyId: String(ctx.companyId), deletedStatusKey: { $ne: 1 }, ...extra };
    if (ctx.projectIds && ctx.projectIds.length) filter.ProjectID = { $in: ctx.projectIds };
    return filter;
};

const taskRow = (t) => ({
    taskId: String(t._id),
    key: t.TaskKey || '',
    title: t.TaskName || '',
    // Stored as { text, key, type }; agents get the readable name, not the object.
    status: (t.status && typeof t.status === 'object') ? (t.status.text || '') : (t.status || ''),
    statusType: t.statusType || (t.status && t.status.type) || '',
    priority: t.Task_Priority || '',
    projectId: String(t.ProjectID || ''),
    sprintId: String(t.sprintId || ''),
    dueDate: t.DueDate || null,
    estimateHours: Number(t.totalEstimatedTime || 0) / 3600 || 0,
});

/* Every tool is one registry action. The registry decides what an agent may do;
 * nothing here widens it. */
const TOOLS = [
    {
        name: 'tasks.next',
        action: 'tasks.next',
        description: 'The next task assigned to you, highest priority and nearest due date first. Start here.',
        input: { type: 'object', properties: { projectId: { type: 'string' } } },
        run: async (ctx, args) => {
            const filter = scopeFilter(ctx, { AssigneeUserId: String(ctx.userId) });
            if (args.projectId && oid(args.projectId)) filter.ProjectID = String(args.projectId);
            const rows = await MongoDbCrudOpration(ctx.companyId, {
                type: SCHEMA_TYPE.TASKS,
                data: [filter, null, { sort: { Task_Priority: 1, DueDate: 1 }, limit: 5 }],
            }, 'find');
            const open = (rows || []).filter((t) => !registry.DONE_STATUS_TYPES.includes(String(t.statusType || '').toLowerCase()));
            return { tasks: open.slice(0, 3).map(taskRow) };
        },
    },
    {
        name: 'tasks.search',
        action: 'tasks.search',
        description: 'Search tasks you can see by text, status or project.',
        input: {
            type: 'object',
            properties: { query: { type: 'string' }, projectId: { type: 'string' }, status: { type: 'string' }, limit: { type: 'integer' } },
        },
        run: async (ctx, args) => {
            const filter = scopeFilter(ctx);
            if (args.query) filter.TaskName = { $regex: str(args.query, 120).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
            if (args.projectId && oid(args.projectId)) filter.ProjectID = String(args.projectId);
            if (args.status) filter.status = { $regex: `^${str(args.status, 60)}$`, $options: 'i' };
            const rows = await MongoDbCrudOpration(ctx.companyId, {
                type: SCHEMA_TYPE.TASKS,
                data: [filter, null, { sort: { updatedAt: -1 }, limit: clampLimit(args.limit) }],
            }, 'find');
            return { tasks: (rows || []).map(taskRow) };
        },
    },
    {
        name: 'task.get',
        action: 'task.get',
        description: 'A task as a brief: goal, acceptance criteria, relations, linked docs and what the comment thread has settled. Read this before writing code.',
        input: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
        run: (ctx, args) => buildBrief(ctx, str(args.taskId, 40)),
    },
    {
        name: 'task.comment',
        action: 'task.comment',
        description: 'Post a comment. Use it to report findings, ask a question, or leave a PR link with context.',
        input: { type: 'object', properties: { taskId: { type: 'string' }, body: { type: 'string' } }, required: ['taskId', 'body'] },
        params: (args) => ({ taskId: str(args.taskId, 40), body: str(args.body, 20000) }),
    },
    {
        name: 'task.status.set',
        action: 'task.status.set',
        description: 'Move a task to In progress or In review. Done is not available to agents — a person closes the task.',
        input: { type: 'object', properties: { taskId: { type: 'string' }, status: { type: 'string' } }, required: ['taskId', 'status'] },
        params: (args) => ({ taskId: str(args.taskId, 40), status: { name: str(args.status, 60) } }),
    },
    {
        name: 'task.link',
        action: 'task.link',
        description: 'Attach a pull request, branch or document URL to the task.',
        input: {
            type: 'object',
            properties: { taskId: { type: 'string' }, url: { type: 'string' }, label: { type: 'string' }, kind: { type: 'string' } },
            required: ['taskId', 'url'],
        },
        params: (args) => ({ taskId: str(args.taskId, 40), url: str(args.url, 2000), label: str(args.label, 200), kind: str(args.kind, 40) || 'link' }),
    },
    {
        name: 'task.create',
        action: 'task.create',
        description: 'File a new task in a project, in its opening status and unassigned. Use it for work you found that is not on the board yet; put the goal and acceptance criteria in the description.',
        input: {
            type: 'object',
            properties: { projectId: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, sprintId: { type: 'string' }, priority: { type: 'string', enum: ['URGENT', 'HIGH', 'MEDIUM', 'LOW'] } },
            required: ['projectId', 'title'],
        },
        params: (args) => ({ projectId: str(args.projectId, 40), title: str(args.title, 250), description: str(args.description, 4000), sprintId: str(args.sprintId, 40), priority: str(args.priority, 10) || 'MEDIUM' }),
    },
    {
        name: 'subtask.create',
        action: 'subtask.create',
        description: 'Break the task down. One subtask per call.',
        input: { type: 'object', properties: { taskId: { type: 'string' }, title: { type: 'string' } }, required: ['taskId', 'title'] },
        params: (args) => ({ taskId: str(args.taskId, 40), title: str(args.title, 250), name: str(args.title, 250) }),
    },
    {
        name: 'timelog.start',
        action: 'timelog.start',
        description: 'Start the timer on a task so the hours you spend are attributed to you.',
        input: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
        params: (args) => ({ taskId: str(args.taskId, 40) }),
    },
    {
        name: 'timelog.stop',
        action: 'timelog.stop',
        description: 'Stop the running timer and write the time log.',
        input: { type: 'object', properties: { taskId: { type: 'string' }, note: { type: 'string' } }, required: ['taskId'] },
        params: (args) => ({ taskId: str(args.taskId, 40), note: str(args.note, 500) }),
    },
    {
        name: 'docs.read',
        action: 'docs.read',
        description: 'Read a page linked from a task, by page id.',
        input: { type: 'object', properties: { pageId: { type: 'string' } }, required: ['pageId'] },
        run: async (ctx, args) => {
            const _id = oid(str(args.pageId, 40));
            if (!_id) return { error: 'invalid pageId' };
            const page = await MongoDbCrudOpration(ctx.companyId, {
                type: SCHEMA_TYPE.PAGES, data: [{ _id, deletedStatusKey: { $ne: 1 } }],
            }, 'findOne');
            if (!page) return { error: 'page not found' };
            return {
                pageId: String(page._id),
                title: page.title || '',
                updatedAt: page.updatedAt || null,
                text: str(page.plainText || page.html || '', 40000),
            };
        },
    },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

const names = () => TOOLS.map((t) => t.name);

const manifest = () => TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.input,
}));

/* Run a tool for an MCP caller. Reads are authorised through the registry;
 * writes go through actions.perform, so they are audited and undoable. */
const call = async (ctx, name, args = {}) => {
    const tool = BY_NAME.get(String(name));
    if (!tool) throw Object.assign(new Error(`Unknown tool "${name}"`), { code: -32601 });

    if (tool.run) {
        await actions.authorizeRead({
            companyId: ctx.companyId, actor: ctx.actor, action: tool.action,
            params: { taskId: args.taskId }, ip: ctx.ip, allowedActions: ctx.allowedActions,
        });
        return tool.run(ctx, args);
    }

    if (!ctx.canWrite) {
        throw Object.assign(new Error('This token is read-only.'), { code: -32004 });
    }
    const out = await actions.perform({
        companyId: ctx.companyId,
        actor: ctx.actor,
        action: tool.action,
        params: tool.params(args),
        reason: str(args.reason, 500) || `${tool.name} via MCP`,
        ip: ctx.ip,
        allowedActions: ctx.allowedActions,
    });
    return { ok: true, auditId: out.auditId, result: out.result || null, undoable: Boolean(out.undo) };
};

module.exports = { TOOLS, names, manifest, call };

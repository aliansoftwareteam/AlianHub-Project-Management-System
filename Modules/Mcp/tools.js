const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const registry = require('../Agents/registry');
const actions = require('../Agents/actions');
const { oid } = require('../Automations/engine/tools');
const { buildBrief } = require('./brief');
const { PAGE_TEXT_MAX, pageText } = require('./pageText');
const { hasScope } = require('../ApiTokens/helpers/apiTokenRules');
const performanceRead = require('../Agents/performanceRead');
const scopes = require('./scopes');
const { heldForApproval } = require('./taintHold');
const visibility = require('./visibility');
const v2 = require('./v2Flag');
const cursor = require('./cursor');
const names = require('./names');
const { annotationsFor, isDestructive } = require('./annotations');
const { propose, outsideMayFile } = require('./propose');
const sessionTools = require('./sessionTools');
const dataTools = require('./dataTools');
const screenTools = require('./screenTools');
const manageFlag = require('./manageFlag');
const manageTools = require('./manageTools');
const workTools = require('./workTools');
const workFlag = require('./workFlag');
const argsSchema = require('./argsSchema');
const { taskRow, planRow } = require('./taskRows');

const str = (v, max = 500) => String(v === undefined || v === null ? '' : v).slice(0, max);
const clampLimit = (v, def = 10, max = 50) => Math.min(Math.max(parseInt(v, 10) || def, 1), max);

const { managesTasks } = manageFlag;

const taskFilter = (ctx, vis, narrowTo, extra = {}) => ({
    CompanyId: String(ctx.companyId), deletedStatusKey: { $ne: 1 }, ...extra, ...vis.taskClause(narrowTo),
});

const taskTarget = (args) => ({ taskId: str(args.taskId, 40) });

const taskPage = async (ctx, tool, args, filter, sort, row = taskRow) => {
    const { rows, nextCursor } = await cursor.page(ctx, tool, args, ({ skip, limit }) => MongoDbCrudOpration(ctx.companyId, {
        type: SCHEMA_TYPE.TASKS, data: [filter, null, { sort, skip, limit }],
    }, 'find'));
    const tasks = await names.forTasks(ctx, rows, row);
    return nextCursor ? { tasks, nextCursor } : { tasks };
};

const briefWithNames = async (ctx, brief) => {
    const task = await MongoDbCrudOpration(ctx.companyId, {
        type: SCHEMA_TYPE.TASKS, data: [{ _id: oid(brief.taskId) }, { ProjectID: 1, sprintId: 1, AssigneeUserId: 1, Task_Priority: 1, TaskType: 1, TaskTypeKey: 1 }],
    }, 'findOne');
    if (!task) return brief;
    const [named] = await names.forTasks(ctx, [task], () => ({}));
    return { ref: named.ref, ...brief, ...named };
};

/* Every tool is one registry action. The registry decides what an agent may do;
 * nothing here widens it. `visibility: 'filtered'` tools read through the caller's
 * filter (run's third argument) or name their write target so it is checked first. */
const TOOLS = [
    {
        name: 'tasks.next',
        action: 'tasks.next',
        description: 'The next task assigned to you, highest priority and nearest due date first. Start here.',
        input: { type: 'object', properties: { projectId: { type: 'string' } } },
        visibility: 'filtered',
        paginated: true,
        run: async (ctx, args, vis) => {
            const filter = taskFilter(ctx, vis, args.projectId, { AssigneeUserId: String(ctx.userId) });
            if (v2.enabled()) {
                filter.statusType = { $nin: [...registry.DONE_STATUS_TYPES] };
                return taskPage(ctx, 'tasks.next', args, filter, { Task_Priority: 1, DueDate: 1, _id: 1 });
            }
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
        paginated: true,
        input: {
            type: 'object',
            properties: { query: { type: 'string' }, projectId: { type: 'string' }, status: { type: 'string' }, limit: { type: 'integer' } },
        },
        visibility: 'filtered',
        run: async (ctx, args, vis) => {
            const filter = taskFilter(ctx, vis, args.projectId);
            if (args.query) filter.TaskName = { $regex: str(args.query, 120).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
            if (args.status) filter.status = { $regex: `^${str(args.status, 60)}$`, $options: 'i' };
            const planning = managesTasks(ctx);
            const named = args.sprintId !== undefined && args.sprintId !== '';
            const inList = workFlag.enabled() && named ? await workTools.listRows(ctx, vis, args.sprintId) : null;
            if (inList && inList.error) return { error: inList.error };
            if (planning) {
                const more = manageTools.searchFilter(inList ? { ...args, sprintId: undefined } : args);
                if (more.error) return { error: more.error };
                // Added beside the caller's own clause: a filter on the same field must narrow it, never replace it.
                filter.$and = [...(filter.$and || []), more.filter];
            }
            if (inList) filter.$and = [...(filter.$and || []), inList.filter];
            const row = planning ? planRow : taskRow;
            if (v2.enabled()) return taskPage(ctx, 'tasks.search', args, filter, { updatedAt: -1, _id: -1 }, row);
            const rows = await MongoDbCrudOpration(ctx.companyId, {
                type: SCHEMA_TYPE.TASKS,
                data: [filter, null, { sort: { updatedAt: -1 }, limit: clampLimit(args.limit) }],
            }, 'find');
            return { tasks: (rows || []).map(row) };
        },
    },
    {
        name: 'task.get',
        action: 'task.get',
        description: 'A task as a brief: goal, acceptance criteria, relations, linked docs and what the comment thread has settled. Read this before writing code.',
        input: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
        visibility: 'filtered',
        run: async (ctx, args, vis) => {
            const brief = await buildBrief(ctx, str(args.taskId, 40), vis);
            if (!brief || brief.error) return brief;
            const named = v2.enabled() ? await briefWithNames(ctx, brief) : brief;
            return managesTasks(ctx) ? manageTools.planBrief(ctx, named) : named;
        },
    },
    {
        name: 'task.comment',
        action: 'task.comment',
        visibility: 'filtered',
        target: taskTarget,
        description: 'Post a comment. Use it to report findings, ask a question, or leave a PR link with context.',
        input: { type: 'object', properties: { taskId: { type: 'string' }, body: { type: 'string' } }, required: ['taskId', 'body'] },
        params: (args) => ({ taskId: str(args.taskId, 40), body: str(args.body, 20000) }),
    },
    {
        name: 'task.status.set',
        action: 'task.status.set',
        visibility: 'filtered',
        target: taskTarget,
        description: 'Move a task to In progress or In review. Done is not available to agents — a person closes the task.',
        input: { type: 'object', properties: { taskId: { type: 'string' }, status: { type: 'string' } }, required: ['taskId', 'status'] },
        params: (args) => ({ taskId: str(args.taskId, 40), status: { name: str(args.status, 60) } }),
    },
    {
        name: 'task.link',
        action: 'task.link',
        visibility: 'filtered',
        target: taskTarget,
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
        visibility: 'filtered',
        target: (args) => ({ projectId: str(args.projectId, 40), sprintId: str(args.sprintId, 40) }),
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
        visibility: 'filtered',
        target: taskTarget,
        description: 'Break the task down. One subtask per call.',
        input: { type: 'object', properties: { taskId: { type: 'string' }, title: { type: 'string' } }, required: ['taskId', 'title'] },
        params: (args) => ({ taskId: str(args.taskId, 40), title: str(args.title, 250), name: str(args.title, 250) }),
    },
    {
        name: 'timelog.start',
        action: 'timelog.start',
        visibility: 'filtered',
        target: taskTarget,
        description: 'Start the timer on a task so the hours you spend are attributed to you.',
        input: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
        params: (args) => ({ taskId: str(args.taskId, 40) }),
    },
    {
        name: 'timelog.stop',
        action: 'timelog.stop',
        visibility: 'filtered',
        target: taskTarget,
        description: 'Stop the running timer and write the time log.',
        input: { type: 'object', properties: { taskId: { type: 'string' }, note: { type: 'string' } }, required: ['taskId'] },
        params: (args) => ({ taskId: str(args.taskId, 40), note: str(args.note, 500) }),
    },
    {
        name: 'docs.read',
        action: 'docs.read',
        description: 'Read a page linked from a task, by page id.',
        input: { type: 'object', properties: { pageId: { type: 'string' } }, required: ['pageId'] },
        visibility: 'filtered',
        run: async (ctx, args, vis) => {
            const _id = oid(str(args.pageId, 40));
            if (!_id) return { error: 'invalid pageId' };
            const page = await MongoDbCrudOpration(ctx.companyId, {
                type: SCHEMA_TYPE.PAGES, data: [{ _id, deletedStatusKey: { $ne: 1 } }],
            }, 'findOne');
            if (!page || !vis.allowsPage(page)) return { error: 'page not found' };
            const out = {
                pageId: String(page._id),
                title: page.title || '',
                updatedAt: page.updatedAt || null,
                text: str(pageText(page), PAGE_TEXT_MAX),
            };
            return v2.enabled() ? { ...(await names.forPage(ctx, page)), ...out } : out;
        },
    },
];

// Offered only while the registry holds their action; TOOLS stays the unflagged list.
const FLAGGED_TOOLS = [
    {
        name: performanceRead.ACTION,
        action: performanceRead.ACTION,
        description: `Numbers for up to ${performanceRead.MAX_PROJECTS} projects over a date range of at most ${performanceRead.MAX_RANGE_DAYS} days: logged time (minutes), estimate against actual (minutes), sprint velocity (story points) and cumulative flow. Quote these numbers rather than estimating; each call is kept in the run's replay record.`,
        input: {
            type: 'object',
            properties: {
                projectId: { type: 'string' },
                projectIds: { type: 'array', items: { type: 'string' }, maxItems: performanceRead.MAX_PROJECTS },
                from: { type: 'string', description: 'First day, YYYY-MM-DD' },
                to: { type: 'string', description: 'Last day, YYYY-MM-DD' },
                metrics: { type: 'array', items: { type: 'string', enum: [...performanceRead.METRICS] } },
            },
            required: ['from', 'to'],
        },
        // Judged per project inside read(): a company-wide check first would refuse a
        // member whose grant comes from the project's own rules.
        authorizesPerProject: true,
        visibility: 'filtered',
        run: async (ctx, args, vis) => {
            const asked = [...(Array.isArray(args.projectIds) ? args.projectIds : []), args.projectId].filter(Boolean).map(String);
            const outside = asked.filter((id) => !vis.allowsProject(id));
            if (outside.length) {
                throw await actions.refusal(ctx.companyId, ctx.actor, {
                    action: performanceRead.ACTION, params: { projectIds: asked }, ip: ctx.ip, entityType: 'project', entityId: outside[0],
                    reason: `${visibility.NOT_VISIBLE}: project ${outside.join(', ')} is not one the person behind this token can open`,
                });
            }
            return performanceRead.read({ companyId: ctx.companyId, actor: ctx.actor, args, projectScope: ctx.projectIds, allowedActions: ctx.allowedActions, ip: ctx.ip });
        },
    },
];

const SEARCH_BY_LIST = 'Search tasks you can see by text, status, project or list. A list answers the tasks that live in it and the tasks added to it.';
const SEARCH_FOR_PLANNING = 'Search tasks you can see by text, status, project, list, assignee or due date. Each task carries its assignees, dates, estimate, subtask count and the tasks above it.';

const offered = () => [...TOOLS, ...FLAGGED_TOOLS.filter((t) => registry.has(t.action)), ...dataTools.offered(), ...screenTools.offered(), ...manageTools.offered(), ...workTools.offered(), ...sessionTools.offered()];

const registered = () => [...TOOLS, ...FLAGGED_TOOLS, ...dataTools.TOOLS, ...screenTools.TOOLS, ...manageTools.TOOLS, ...Object.values(manageTools.VARIANTS), ...workTools.TOOLS, ...sessionTools.TOOLS];

/* A tool that needs a grant is one only a caller holding that grant lists or runs. */
const holdsGrantFor = (ctx, tool) => !tool.grant || manageFlag.mayUse(ctx, tool.grant);

/* For a caller whose token was created to manage tasks, an existing tool is its fuller form; for everyone else it is as it was. */
const formFor = (ctx, tool) => {
    const variant = manageTools.variantOf(tool.name);
    if (variant && holdsGrantFor(ctx, variant)) return variant;
    if (tool.name !== 'tasks.search') return tool;
    const planning = managesTasks(ctx);
    const byList = workFlag.enabled();
    if (!planning && !byList) return tool;
    const more = { ...(planning ? manageTools.SEARCH_INPUT : {}), ...(byList ? workTools.SEARCH_INPUT : {}) };
    return { ...tool, description: planning ? SEARCH_FOR_PLANNING : SEARCH_BY_LIST, input: { ...tool.input, properties: { ...tool.input.properties, ...more } } };
};

const toolsFor = (ctx) => offered().filter((tool) => holdsGrantFor(ctx, tool)).map((tool) => formFor(ctx, tool));

const toolNames = () => offered().map((t) => t.name);

const PAGE_INPUT = Object.freeze({
    cursor: { type: 'string', description: 'nextCursor from the previous page' },
    limit: { type: 'integer', description: `Page size, default ${cursor.PAGE_DEFAULT}, at most ${cursor.PAGE_MAX}` },
});

/* With a caller, the tools that caller may use; without one (the public manifest), every tool this server offers. */
const manifest = (ctx = null) => {
    const listed = ctx ? toolsFor(ctx) : offered();
    if (!v2.enabled()) return listed.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input }));
    return listed.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.paginated ? { ...t.input, properties: { ...t.input.properties, ...PAGE_INPUT } } : t.input,
        annotations: t.annotations || annotationsFor(actions.rating(t.action)),
    }));
};

const actionOf = (name) => { const tool = offered().find((t) => t.name === String(name)); return tool ? tool.action : null; };
const actionsOffered = () => [...offered(), ...Object.values(manageTools.VARIANTS).filter((t) => registry.has(t.action))].map((t) => t.action);

/* An OAuth token is held to the one scope the tool needs; a personal token keeps its read/write rule. */
const PAGE_ARGS = Object.freeze({ cursor: { type: 'string', maxLength: 2000 }, limit: { type: 'integer', minimum: 1, maximum: cursor.PAGE_MAX } });

const refuseBadArguments = (tool, args) => {
    if (!tool.strict) return;
    const problem = argsSchema.problemIn(tool.input, args, tool.paginated ? PAGE_ARGS : {}) || (tool.check ? tool.check(args) : '');
    if (problem) throw Object.assign(new Error(`${tool.name}: ${problem}`), { code: -32602 });
};

const scopeRefusal = (ctx, tool, write) => {
    if (tool.grant && !manageFlag.holdsGrant(ctx.token, tool.grant)) return `This token does not hold the ${tool.grant} grant, which ${tool.name} needs.`;
    if (tool.grant && !manageFlag.mayUse(ctx, tool.grant)) return 'This token is read-only.';
    if (ctx.token && ctx.token.oauth) {
        const needed = scopes.scopeForTool(tool.name);
        return needed && scopes.grantedScopes(ctx.token).includes(needed) ? '' : `This token lacks the ${needed || 'required'} scope.`;
    }
    if (write) return ctx.canWrite ? '' : 'This token is read-only.';
    return hasScope(ctx.token, 'read') ? '' : 'This token lacks the read scope.';
};

/* The tools a caller both lists and may run, which is what the instructions and the prompts may name.
 * tools/list shows a write tool to a connection that only reads; a call of it is refused. */
const usable = (ctx) => toolsFor(ctx)
    .filter((tool) => !sessionTools.owns(tool.name))
    .filter((tool) => !scopeRefusal(ctx, tool, !tool.run))
    .filter((tool) => !(Array.isArray(ctx.allowedActions) && ctx.allowedActions.length) || ctx.allowedActions.includes(tool.action))
    .map((tool) => ({ name: tool.name, write: !tool.run }));

/* Run a tool for an MCP caller. Reads are authorised through the registry;
 * writes go through actions.perform, so they are audited and undoable. */
const call = async (ctx, name, args = {}) => {
    if (sessionTools.owns(name)) return sessionTools.call(ctx, name, args);
    const plain = offered().find((t) => t.name === String(name));
    if (!plain) throw Object.assign(new Error(`Unknown tool "${name}"`), { code: -32601 });
    const tool = formFor(ctx, plain);
    await require('../Workflows/externalSession').checkToolCall(ctx, tool.name);
    if (!['filtered', 'none'].includes(tool.visibility)) throw new Error(`${tool.name} declares no visibility`);
    const filtered = tool.visibility === 'filtered';

    if (tool.run) {
        const refused = scopeRefusal(ctx, tool, false);
        if (refused) throw Object.assign(new Error(refused), { code: -32004 });
        refuseBadArguments(tool, args);
        if (!tool.authorizesPerProject) await actions.authorizeRead({
            companyId: ctx.companyId, actor: ctx.actor, action: tool.action,
            params: tool.readParams ? tool.readParams(args) : { taskId: args.taskId }, ip: ctx.ip, allowedActions: ctx.allowedActions,
        });
        return tool.run(ctx, args, filtered ? await visibility.forCaller(ctx) : undefined);
    }

    const refused = scopeRefusal(ctx, tool, true);
    if (refused) throw Object.assign(new Error(refused), { code: -32004 });
    refuseBadArguments(tool, args);
    if (tool.batch) return runBatch(ctx, tool, args);
    const params = tool.params(args);
    if (filtered) {
        try {
            await visibility.assertWritable(ctx.companyId, await visibility.forCaller(ctx), tool.target(args));
        } catch (error) {
            if (!error.notVisible) throw error;
            throw await actions.refusal(ctx.companyId, ctx.actor, { action: tool.action, params, reason: error.message, ip: ctx.ip, taint: ctx.taint });
        }
    }
    const held = heldForApproval(ctx, tool.action);
    // An outside client that holds the tool's manage grant files what is held for a person; without the grant the call is refused, as before.
    if (held && !outsideMayFile(ctx, tool)) {
        throw await actions.refusal(ctx.companyId, ctx.actor, { action: tool.action, params, reason: held, ip: ctx.ip, taint: ctx.taint });
    }
    if (held || (v2.enabled() && isDestructive(actions.rating(tool.action)))) {
        return propose(ctx, tool, params, str(args.reason, 500) || `${tool.name} via MCP`, held);
    }
    const out = await actions.perform({
        companyId: ctx.companyId,
        actor: ctx.actor,
        action: tool.action,
        params,
        reason: str(args.reason, 500) || `${tool.name} via MCP`,
        ip: ctx.ip,
        allowedActions: ctx.allowedActions,
        ...(ctx.taint ? { taint: ctx.taint } : {}),
    });
    return { ok: true, auditId: out.auditId, result: out.result || null, undoable: Boolean(out.undo) };
};

/* One operation of a batch: a write tool this caller has, run exactly as a call of its own, with its outcome instead of a throw. */
const batchItem = async (ctx, operation) => {
    const name = String(operation.tool);
    const tool = toolsFor(ctx).find((t) => t.name === name);
    if (!tool || tool.run || tool.batch || sessionTools.owns(name)) return { ok: false, error: `${name} is not a write tool a batch can run` };
    try {
        return await call(ctx, name, operation.arguments);
    } catch (error) {
        if (error instanceof actions.RefusedError) return { ok: false, refused: true, reason: error.message, auditId: error.auditId || null };
        return { ok: false, error: error.message };
    }
};

async function runBatch(ctx, tool, args) {
    const items = [];
    for (const [index, operation] of args.operations.entries()) {
        items.push({ index, tool: String(operation.tool), ...(await batchItem(ctx, operation)) });
    }
    const applied = items.filter((item) => item.ok === true && item.auditId);
    const first = applied.length ? args.operations[applied[0].index].arguments : {};
    const group = applied.length ? await actions.perform({
        companyId: ctx.companyId, actor: ctx.actor, action: tool.action, ip: ctx.ip, allowedActions: ctx.allowedActions,
        params: { auditIds: applied.map((item) => item.auditId), tools: applied.map((item) => item.tool), ...(first.taskId ? { taskId: str(first.taskId, 40) } : {}), ...(first.projectId ? { projectId: str(first.projectId, 40) } : {}) },
        reason: str(args.reason, 500) || `${tool.name} via MCP`,
    }) : null;
    return {
        ok: items.every((item) => item.ok === true), applied: applied.length, notApplied: items.length - applied.length,
        auditId: group ? group.auditId : null, undoable: Boolean(group && group.undo), items,
    };
}

module.exports = { TOOLS, names: toolNames, manifest, usable, call, registered, actionOf, actionsOffered };

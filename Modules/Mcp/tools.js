const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const registry = require('../Agents/registry');
const actions = require('../Agents/actions');
const { oid } = require('../Automations/engine/tools');
const { escapeRegex } = require('../../utils/escapeRegex');
const { buildBrief } = require('./brief');
const { PAGE_TEXT_MAX, pageText } = require('./pageText');
const { hasScope } = require('../ApiTokens/helpers/apiTokenRules');
const performanceRead = require('../Agents/performanceRead');
const scopes = require('./scopes');
const { heldForApproval } = require('./taintHold');
const projectPolicy = require('../Agents/projectPolicy');
const taskReads = require('../Agents/taskReads');
const visibility = require('./visibility');
const v2 = require('./v2Flag');
const cursor = require('./cursor');
const names = require('./names');
const { annotationsFor, isDestructive } = require('./annotations');
const { propose, proposeBatch, afterManyTasks, fileable, outsideMayFile, declinedNotes } = require('./propose');
const sessionTools = require('./sessionTools');
const dataTools = require('./dataTools');
const screenTools = require('./screenTools');
const intentTools = require('./intentTools');
const contextTools = require('./contextTools');
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
        description: 'Shows the next task assigned to the person: the most urgent first, then the soonest due. Changes nothing.',
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
        description: 'Finds tasks the person can open, by text, status or project. Changes nothing.',
        paginated: true,
        input: {
            type: 'object',
            properties: { query: { type: 'string' }, projectId: { type: 'string' }, status: { type: 'string' }, limit: { type: 'integer' } },
        },
        visibility: 'filtered',
        run: async (ctx, args, vis) => {
            const filter = taskFilter(ctx, vis, args.projectId);
            if (args.query) filter.TaskName = { $regex: escapeRegex(str(args.query, 120)), $options: 'i' };
            if (args.status) filter.status = { $regex: `^${escapeRegex(str(args.status, 60))}$`, $options: 'i' };
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
        description: 'Shows one task in full: its goal, what counts as done, linked tasks and docs, and what the comments settled. Read it before you work on the task. Changes nothing.',
        input: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
        visibility: 'filtered',
        run: async (ctx, args, vis) => {
            const taskId = str(args.taskId, 40);
            const stamp = oid(taskId) ? await taskReads.stampOf(ctx.companyId, taskId) : null;
            const brief = await buildBrief(ctx, taskId, vis);
            if (!brief || brief.error) return brief;
            if (stamp) await taskReads.saw(ctx.companyId, ctx.actor, taskId, stamp);
            const named = v2.enabled() ? await briefWithNames(ctx, brief) : brief;
            const out = await (managesTasks(ctx) ? manageTools.planBrief(ctx, named) : named);
            const declined = await declinedNotes(ctx, brief.project && brief.project.id);
            return declined ? { ...out, declined } : out;
        },
    },
    {
        name: 'task.comment',
        action: 'task.comment',
        visibility: 'filtered',
        target: taskTarget,
        description: 'Adds a comment to a task at once, and the person can undo it. Use it to report what you found, ask a question or share a link.',
        input: { type: 'object', properties: { taskId: { type: 'string' }, body: { type: 'string' } }, required: ['taskId', 'body'] },
        params: (args) => ({ taskId: str(args.taskId, 40), body: str(args.body, 20000) }),
    },
    {
        name: 'task.status.set',
        action: 'task.status.set',
        visibility: 'filtered',
        target: taskTarget,
        description: 'Sets a task to In progress or In review at once. You cannot close a task: a person does that.',
        input: { type: 'object', properties: { taskId: { type: 'string' }, status: { type: 'string' } }, required: ['taskId', 'status'] },
        params: (args) => ({ taskId: str(args.taskId, 40), status: { name: str(args.status, 60) } }),
    },
    {
        name: 'task.link',
        action: 'task.link',
        visibility: 'filtered',
        target: taskTarget,
        description: 'Attaches a link to a task, such as a pull request, a branch or a doc, at once. The person can undo it.',
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
        creates: true,
        target: (args) => ({ projectId: str(args.projectId, 40), sprintId: str(args.sprintId, 40) }),
        description: 'Adds a new task to a project, unassigned and in its first status, at once. Use it for work that is not on the board yet, and put the goal and what counts as done in the description.',
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
        creates: true,
        target: taskTarget,
        description: 'Adds one subtask to a task at once. Call it once for each subtask.',
        input: { type: 'object', properties: { taskId: { type: 'string' }, title: { type: 'string' } }, required: ['taskId', 'title'] },
        params: (args) => ({ taskId: str(args.taskId, 40), title: str(args.title, 250), name: str(args.title, 250) }),
    },
    {
        name: 'timelog.start',
        action: 'timelog.start',
        visibility: 'filtered',
        target: taskTarget,
        description: 'Starts a timer on a task at once, so the time is logged for the person.',
        input: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
        params: (args) => ({ taskId: str(args.taskId, 40) }),
    },
    {
        name: 'timelog.stop',
        action: 'timelog.stop',
        visibility: 'filtered',
        target: taskTarget,
        description: 'Stops the running timer at once and saves the time as a time entry.',
        input: { type: 'object', properties: { taskId: { type: 'string' }, note: { type: 'string' } }, required: ['taskId'] },
        params: (args) => ({ taskId: str(args.taskId, 40), note: str(args.note, 500) }),
    },
    {
        name: 'docs.read',
        action: 'docs.read',
        description: 'Shows a doc linked from a task, given its id. Changes nothing.',
        input: { type: 'object', properties: { pageId: { type: 'string' } }, required: ['pageId'] },
        visibility: 'filtered',
        run: async (ctx, args, vis) => {
            const _id = oid(str(args.pageId, 40));
            if (!_id) return { error: 'That is not a doc id. Use an id from pages.search.' };
            const page = await MongoDbCrudOpration(ctx.companyId, {
                type: SCHEMA_TYPE.PAGES, data: [{ _id, deletedStatusKey: { $ne: 1 } }],
            }, 'findOne');
            if (!page || !vis.allowsPage(page)) return { error: 'That doc was not found. Ask the person which doc they mean.' };
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
        description: `Shows numbers for up to ${performanceRead.MAX_PROJECTS} projects over at most ${performanceRead.MAX_RANGE_DAYS} days: time logged, estimated against actual time (both in minutes), story points finished per list, and how tasks moved between statuses. Quote these numbers rather than estimating. Changes nothing.`,
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
                    reason: `${visibility.NOT_VISIBLE}: project ${outside.join(', ')} was not found, or the person cannot open it. Ask the person which project they mean.`,
                });
            }
            return performanceRead.read({ companyId: ctx.companyId, actor: ctx.actor, args, projectScope: ctx.projectIds, allowedActions: ctx.allowedActions, ip: ctx.ip });
        },
    },
];

const SEARCH_BY_LIST = 'Finds tasks the person can open, by text, status, project or list. A list answers the tasks that live in it and the tasks added to it. Changes nothing.';
const SEARCH_FOR_PLANNING = 'Finds tasks the person can open, by text, status, project, list, assignee or due date. Each task shows its assignees, dates, estimate, subtask count and the tasks above it. Changes nothing.';

const offered = () => [...TOOLS, ...FLAGGED_TOOLS.filter((t) => registry.has(t.action)), ...dataTools.offered(), ...screenTools.offered(), ...intentTools.offered(), ...contextTools.offered(), ...manageTools.offered(), ...workTools.offered(), ...sessionTools.offered()];

const registered = () => [...TOOLS, ...FLAGGED_TOOLS, ...dataTools.TOOLS, ...screenTools.TOOLS, ...intentTools.TOOLS, ...contextTools.TOOLS, ...manageTools.TOOLS, ...Object.values(manageTools.VARIANTS), ...workTools.TOOLS, ...sessionTools.TOOLS];

/* A tool that needs a grant, or a scope a person gives only by name, is one only a caller holding it lists or runs. */
const holdsOptIn = (ctx, tool) => !tool.optIn || scopes.grantedScopes(ctx && ctx.token).includes(tool.optIn);
const holdsGrantFor = (ctx, tool) => (!tool.grant || manageFlag.mayUse(ctx, tool.grant)) && holdsOptIn(ctx, tool);

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
    cursor: { type: 'string', description: 'The nextCursor from the previous page, to get the next page' },
    limit: { type: 'integer', description: `How many to return: ${cursor.PAGE_DEFAULT} unless you ask for another number, and at most ${cursor.PAGE_MAX}` },
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

const argumentProblem = (tool, args) => (tool.strict
    ? argsSchema.problemIn(tool.input, args, tool.paginated ? PAGE_ARGS : {}) || (tool.check ? tool.check(args) : '')
    : '');

const refuseBadArguments = (tool, args) => {
    const problem = argumentProblem(tool, args);
    if (problem) throw Object.assign(new Error(`${tool.name}: ${problem}`), { code: -32602 });
};

const scopeRefusal = (ctx, tool, write) => {
    if (!holdsOptIn(ctx, tool)) return `This connection was not given the ${tool.optIn} permission. Ask the person to connect you again and allow it.`;
    if (tool.grant && !manageFlag.holdsGrant(ctx.token, tool.grant)) return `This connection was not given the ${tool.grant} permission, which ${tool.name} needs. Ask the person to connect you again and allow it.`;
    if (tool.grant && !manageFlag.mayUse(ctx, tool.grant)) return 'This connection can only read. Ask the person to connect you again and allow changes.';
    if (ctx.token && ctx.token.oauth) {
        const needed = scopes.scopeForTool(tool.name);
        return needed && scopes.grantedScopes(ctx.token).includes(needed) ? '' : `This connection was not given the ${needed || 'required'} permission. Ask the person to connect you again and allow it.`;
    }
    if (write) return ctx.canWrite ? '' : 'This connection can only read. Ask the person to connect you again and allow changes.';
    return hasScope(ctx.token, 'read') ? '' : 'This connection is not allowed to read. Ask the person to connect you again and allow it.';
};

/* The tools a caller both lists and may run, which is what the instructions and the prompts may name.
 * tools/list shows a write tool to a connection that only reads; a call of it is refused. */
const usable = (ctx) => toolsFor(ctx)
    .filter((tool) => !sessionTools.owns(tool.name))
    .filter((tool) => !scopeRefusal(ctx, tool, !tool.run))
    .filter((tool) => !(Array.isArray(ctx.allowedActions) && ctx.allowedActions.length) || ctx.allowedActions.includes(tool.action))
    .map((tool) => ({ name: tool.name, write: !tool.run }));

/* A write built from something the tool reads first: its arguments, or its answer when there is nothing to build from.
 * A connection kept away from the action is refused before that read, so the answer tells it nothing. Whether the
 * write then runs or waits for a person is decided after it is prepared. */
const prepare = async (ctx, tool, args, vis) => {
    const may = registry.evaluate(tool.action, { __proposal: true }, { allowedActions: ctx.allowedActions });
    if (!may.allowed) throw await actions.refusal(ctx.companyId, ctx.actor, { action: tool.action, params: {}, reason: may.reason, ip: ctx.ip, taint: ctx.taint });
    return tool.prepare(ctx, args, vis);
};

const admitWrite = (ctx, tool, args) => {
    const refused = scopeRefusal(ctx, tool, true);
    if (refused) throw Object.assign(new Error(refused), { code: -32004 });
    refuseBadArguments(tool, args);
};

/* A write taken to the point where it either runs or is filed: its params, the project's answer and why it is held,
 * or the answer its preparation already gave. It throws what a call of the tool throws until then, and changes nothing. */
const readied = async (ctx, tool, args) => {
    const filtered = tool.visibility === 'filtered';
    const vis = filtered ? await visibility.forCaller(ctx) : undefined;
    const prepared = tool.prepare ? await prepare(ctx, tool, args, vis) : { args };
    if (prepared.answer) return { answer: prepared.answer };
    const params = tool.params(prepared.args);
    if (filtered) {
        try {
            await visibility.assertWritable(ctx.companyId, vis, tool.target(prepared.args));
        } catch (error) {
            if (!error.notVisible) throw error;
            throw await actions.refusal(ctx.companyId, ctx.actor, { action: tool.action, params, reason: error.message, ip: ctx.ip, taint: ctx.taint });
        }
    }
    const tainted = heldForApproval(ctx, tool.action);
    // An outside client that holds the tool's manage grant files what is held for a person; without the grant the call is refused, as before.
    if (tainted && !outsideMayFile(ctx, tool)) {
        throw await actions.refusal(ctx.companyId, ctx.actor, { action: tool.action, params, reason: tainted, ip: ctx.ip, taint: ctx.taint });
    }
    // A refusal by the project is left to perform(), which gives the registry's and the holder's refusals first.
    const rule = await projectPolicy.ask({ companyId: ctx.companyId, actor: ctx.actor, action: tool.action, params, taint: ctx.taint, standing: true });
    return { params, rule, held: tainted || (rule.decision === projectPolicy.DECISION.PROPOSE ? rule.reason : '') };
};

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
        let vis;
        const seen = async () => { vis = vis || await visibility.forCaller(ctx); return vis; };
        const params = tool.readParams ? tool.readParams(args) : { taskId: args.taskId };
        if (!tool.authorizesPerProject) await actions.authorizeRead({
            companyId: ctx.companyId, actor: ctx.actor, action: tool.action, params, ip: ctx.ip, allowedActions: ctx.allowedActions,
            opens: filtered ? async () => visibility.opensNamed(ctx.companyId, await seen(), params) : null,
        });
        return tool.run(ctx, args, filtered ? await seen() : undefined);
    }

    admitWrite(ctx, tool, args);
    if (tool.batch) return runBatch(ctx, tool, args);
    const ready = await readied(ctx, tool, args);
    if (ready.answer) return ready.answer;
    const { params, rule, held } = ready;
    if (rule.decision !== projectPolicy.DECISION.REFUSE && (held || (v2.enabled() && isDestructive(actions.rating(tool.action))))) {
        const filed = await propose(ctx, tool, params, str(args.reason, 500) || `${tool.name} via MCP`, held);
        return rule.manyTasks ? afterManyTasks(filed, rule.reason, toolsFor(ctx).some((listed) => listed.batch)) : filed;
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
    return { ok: true, auditId: out.auditId, result: out.result || null, undoable: Boolean(out.undo), ...(out.standing ? { standingApprovalId: out.standing.id } : {}) };
};

const NOT_BATCHABLE = 'is not a write tool a batch can run';

/* The write tool a batch's operation names for this caller, or null. */
const batchTool = (ctx, operation) => {
    const name = String(operation.tool);
    const tool = toolsFor(ctx).find((t) => t.name === name);
    return !tool || tool.run || tool.batch || sessionTools.owns(name) ? null : tool;
};

const outcomeOf = (error) => (error instanceof actions.RefusedError
    ? { ok: false, refused: true, reason: error.message, auditId: error.auditId || null }
    : { ok: false, error: error.message });

/* One operation of a batch: a write tool this caller has, run exactly as a call of its own, with its outcome instead of a throw. */
const batchItem = async (ctx, operation) => {
    const name = String(operation.tool);
    if (!batchTool(ctx, operation)) return { ok: false, error: `${name} ${NOT_BATCHABLE}` };
    try {
        return await call(ctx, name, operation.arguments);
    } catch (error) {
        return outcomeOf(error);
    }
};

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/* What one operation reaches, as far as its arguments say: every task its target names, the task it links to
 * beside the one it starts from. A tool that makes a new task or doc (`creates`) reaches that new one, and so does
 * one that names no task or names its target only once prepared: each counts as one of its own. */
const reachOf = (tool, args, index) => {
    const own = [`operation:${index}`];
    if (tool.creates || tool.prepare || !tool.target) return own;
    try {
        const target = tool.target(args);
        const tasks = [target.taskId, target.relatedTaskId].map((id) => String(id || '').toLowerCase()).filter((id) => OBJECT_ID.test(id));
        return tasks.length ? tasks.map((id) => `task:${id}`) : own;
    } catch (error) {
        return own;
    }
};

/* How many tasks a batch reaches. An operation no call could make reaches nothing. */
const tasksNamed = (ctx, operations) => new Set(operations.flatMap((operation, index) => {
    const tool = batchTool(ctx, operation);
    if (!tool || scopeRefusal(ctx, tool, true) || argumentProblem(tool, operation.arguments)) return [];
    return reachOf(tool, operation.arguments, index);
})).size;

/* One operation of a batch that waits: taken as far as a call of its own goes before it would run, then asked what
 * filing asks. Answers the change to file, or the outcome that keeps it out. Nothing runs here. */
const batchChange = async (ctx, operation) => {
    const name = String(operation.tool);
    const tool = batchTool(ctx, operation);
    if (!tool) return { outcome: { ok: false, error: `${name} ${NOT_BATCHABLE}` } };
    try {
        await require('../Workflows/externalSession').checkToolCall(ctx, tool.name);
        admitWrite(ctx, tool, operation.arguments);
        const ready = await readied(ctx, tool, operation.arguments);
        if (ready.answer) return { outcome: ready.answer };
        await fileable(ctx, tool, ready.params);
        if (ready.rule.decision === projectPolicy.DECISION.REFUSE) {
            throw await actions.refusal(ctx.companyId, ctx.actor, { action: tool.action, params: ready.params, reason: ready.rule.reason, ip: ctx.ip, taint: ctx.taint });
        }
        return { change: { tool, params: ready.params } };
    } catch (error) {
        return { outcome: outcomeOf(error) };
    }
};

/* Decision 6 of task 047: over MCP a change to one task may be applied at once, and anything wider waits. A batch
 * that reaches more than one task therefore runs nothing: what a call could make of it is filed as one proposal. */
const fileBatch = async (ctx, tool, args) => {
    const taken = [];
    for (const operation of args.operations) taken.push(await batchChange(ctx, operation));
    const changes = taken.map((entry) => entry.change).filter(Boolean);
    const filed = changes.length ? await proposeBatch(ctx, changes, str(args.reason, 500) || `${tool.name} via MCP`) : { ok: false };
    const waiting = filed.pending ? { ok: false, pending: true } : { ok: false, notFiled: true };
    const items = taken.map((entry, index) => ({ index, tool: String(args.operations[index].tool), ...(entry.change ? waiting : entry.outcome) }));
    return { ...filed, applied: 0, notApplied: items.length, waiting: filed.pending ? changes.length : 0, auditId: null, undoable: false, items };
};

const applyBatch = async (ctx, tool, args) => {
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
};

/* A batch of one operation is that operation's own call, which waits or runs by the rule for a single change. */
function runBatch(ctx, tool, args) {
    return args.operations.length > 1 && tasksNamed(ctx, args.operations) > 1 ? fileBatch(ctx, tool, args) : applyBatch(ctx, tool, args);
}

module.exports = { TOOLS, names: toolNames, manifest, usable, call, registered, actionOf, actionsOffered };

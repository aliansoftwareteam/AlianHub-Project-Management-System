const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const registry = require('../Agents/registry');
const actions = require('../Agents/actions');
const { oid } = require('../Automations/engine/tools');
const { resolveSheetScope, SHEET_PERMISSION } = require('../TimeSheet/helpers/timeScope');
const { NOT_VISIBLE } = require('./visibility');
const v2 = require('./v2Flag');
const cursor = require('./cursor');
const names = require('./names');
const { PAGE_TEXT_MAX, pageText } = require('./pageText');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_SECONDS = 24 * 60 * 60;

const isId = (v) => OBJECT_ID.test(String(v || ''));
const idOf = (v) => (v === undefined || v === null ? '' : String(v));
const str = (v, max = 500) => String(v === undefined || v === null ? '' : v).slice(0, max);
const clampLimit = (v) => Math.min(Math.max(parseInt(v, 10) || cursor.PAGE_DEFAULT, 1), cursor.PAGE_MAX);
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const oids = (ids) => ids.filter(isId).map(oid);

const find = (ctx, type, filter, fields, options) => MongoDbCrudOpration(ctx.companyId, { type, data: [filter, fields || null, options] }, 'find');
const findOne = (ctx, type, filter, fields) => MongoDbCrudOpration(ctx.companyId, { type, data: [filter, fields || null] }, 'findOne');

/* One page of rows: signed cursors and names with MCP_TOOLS_V2 on, a plain capped list otherwise. */
const listOf = async (ctx, tool, args, key, { type, filter, sort, fields }, row, named) => {
    if (!v2.enabled()) {
        const rows = await find(ctx, type, filter, fields, { sort, limit: clampLimit(args.limit) });
        return { [key]: (rows || []).map(row) };
    }
    const { rows, nextCursor } = await cursor.page(ctx, tool, args, ({ skip, limit }) => find(ctx, type, filter, fields, { sort, skip, limit }));
    const out = await named(rows);
    return nextCursor ? { [key]: out, nextCursor } : { [key]: out };
};

const projectParams = (args) => (isId(args.projectId) ? { projectId: String(args.projectId) } : {});

// Another person's personal list stays theirs even for owners and admins (Modules/Agents/scope).
const personalClause = (ctx) => ({ $or: [{ isPersonal: { $ne: true } }, { personalOwner: String(ctx.userId) }] });

const loadProject = async (ctx, vis, projectId) => {
    if (!isId(projectId) || !vis.allowsProject(projectId)) return null;
    const project = await findOne(ctx, SCHEMA_TYPE.PROJECTS, { _id: oid(projectId), deletedStatusKey: { $nin: [1] } });
    if (!project || (project.isPersonal === true && String(project.personalOwner || '') !== String(ctx.userId))) return null;
    return project;
};

const NO_PROJECT = Object.freeze({ error: 'project not found' });
const NO_TASK = Object.freeze({ error: 'task not found' });
const NO_PAGE = Object.freeze({ error: 'page not found' });

const projectRow = (p) => ({
    projectId: String(p._id),
    name: p.ProjectName || '',
    key: p.ProjectCode || '',
    private: p.isPrivateSpace === true,
    status: p.statusType || '',
    dueDate: p.DueDate || null,
});

const sprintRow = (s) => ({
    sprintId: String(s._id),
    name: s.name || s.sprintName || '',
    projectId: idOf(s.projectId),
    private: s.private === true,
    startDate: s.startDate || null,
    endDate: s.endDate || null,
    state: s.state || '',
});

const statusRows = (project) => (Array.isArray(project.taskStatusData) ? project.taskStatusData : [])
    .map((row) => (row && row.convertStatus ? row.convertStatus : row))
    .filter(Boolean)
    .map((s) => ({ key: s.key, name: s.name || '', type: s.type || '', color: s.bgColor || '' }));

const commentRow = (c) => ({
    commentId: String(c._id),
    text: c.message || '',
    type: c.type || 'text',
    authorId: idOf(c.userId),
    ...(c.actorType ? { actorType: c.actorType } : {}),
    createdAt: c.createdAt || null,
});

const pageRow = (p) => ({
    pageId: String(p._id),
    title: p.title || '',
    projectId: idOf(p.ProjectID),
    private: p.visibility === 'private',
    updatedAt: p.updatedAt || null,
});

const entryRow = (e) => ({
    timesheetId: String(e._id),
    userId: idOf(e.Loggeduser),
    taskId: idOf(e.TicketID),
    projectId: idOf(e.ProjectId),
    startedAt: Number.isFinite(Number(e.LogStartTime)) ? new Date(Number(e.LogStartTime) * 1000).toISOString() : null,
    minutes: Number(e.LogTimeDuration || 0),
    description: e.LogDescription || '',
    billable: e.billable !== false,
    running: Boolean(e.startTimeTracker),
});

const LIMIT = { limit: { type: 'integer' } };
const PROJECT_ARG = { projectId: { type: 'string' } };

/* The projects a timesheet read may cover: the token's and the argument's narrowing on top of the sheet scope. */
const entryProjects = (ctx, vis, args, sheetVisible) => {
    let allowed = sheetVisible ? sheetVisible.map(String) : null;
    const narrow = (ids) => { allowed = allowed === null ? ids : allowed.filter((id) => ids.includes(id)); };
    if (Array.isArray(ctx.projectIds) && ctx.projectIds.length) narrow((vis.projectIds || ctx.projectIds).map(String));
    if (args.projectId !== undefined && args.projectId !== '') narrow(vis.allowsProject(args.projectId) ? [String(args.projectId)] : []);
    return allowed;
};

const dayRange = (args) => {
    const from = args.from ? String(args.from) : '';
    const to = args.to ? String(args.to) : '';
    if ((from && !DAY.test(from)) || (to && !DAY.test(to))) return { error: 'from and to must be YYYY-MM-DD' };
    const range = {};
    if (from) range.$gte = Date.parse(`${from}T00:00:00Z`) / 1000;
    if (to) range.$lte = Date.parse(`${to}T00:00:00Z`) / 1000 + DAY_SECONDS - 1;
    if (Object.values(range).some((v) => !Number.isFinite(v))) return { error: 'from and to must be YYYY-MM-DD' };
    return { range: Object.keys(range).length ? range : null };
};

/* Every tool is a registry action registered only while MCP_TOOLS_DATA is on, and each reads
 * through the caller's filter or names its write target so tools.call checks it first. */
const TOOLS = [
    {
        name: 'projects.list',
        action: 'projects.list',
        description: 'Projects you can open, by name. Use a projectId from here with the other tools.',
        input: { type: 'object', properties: { query: { type: 'string', description: 'Part of the project name' }, ...LIMIT } },
        visibility: 'filtered',
        paginated: true,
        readParams: () => ({}),
        run: async (ctx, args, vis) => {
            const filter = { deletedStatusKey: { $nin: [1] }, $and: [personalClause(ctx)] };
            if (vis.projectIds !== null) filter._id = { $in: oids(vis.projectIds) };
            if (args.query) filter.ProjectName = { $regex: escapeRegex(str(args.query, 120)), $options: 'i' };
            return listOf(ctx, 'projects.list', args, 'projects', { type: SCHEMA_TYPE.PROJECTS, filter, sort: { ProjectName: 1, _id: 1 } }, projectRow,
                async (rows) => rows.map((p) => ({ ref: `project:${p._id}`, ...projectRow(p) })));
        },
    },
    {
        name: 'project.get',
        action: 'project.get',
        description: 'One project: its name, key, whether it is private, its members and how many statuses it has.',
        input: { type: 'object', properties: PROJECT_ARG, required: ['projectId'] },
        visibility: 'filtered',
        readParams: projectParams,
        run: async (ctx, args, vis) => {
            const project = await loadProject(ctx, vis, args.projectId);
            if (!project) return { ...NO_PROJECT };
            const memberIds = (Array.isArray(project.AssigneeUserId) ? project.AssigneeUserId : []).map(String).filter(isId);
            const out = { ...projectRow(project), members: memberIds, statusCount: statusRows(project).length };
            if (!v2.enabled()) return out;
            const named = await names.resolver(ctx, { projectIds: [out.projectId], userIds: memberIds });
            return { ref: `project:${out.projectId}`, ...out, members: memberIds.map((id) => named.person(id, out.projectId)) };
        },
    },
    {
        name: 'sprints.list',
        action: 'sprints.list',
        description: 'The sprints of one project. A private sprint is listed only for the people on it, and for owners and admins.',
        input: { type: 'object', properties: { ...PROJECT_ARG, ...LIMIT }, required: ['projectId'] },
        visibility: 'filtered',
        paginated: true,
        readParams: projectParams,
        run: async (ctx, args, vis) => {
            const project = await loadProject(ctx, vis, args.projectId);
            if (!project) return { ...NO_PROJECT };
            const filter = { projectId: oid(String(project._id)), deletedStatusKey: { $ne: 1 } };
            if (vis.hiddenSprintIds.length) filter._id = { $nin: oids(vis.hiddenSprintIds.map(String)) };
            return listOf(ctx, 'sprints.list', args, 'sprints', { type: SCHEMA_TYPE.SPRINTS, filter, sort: { _id: 1 } }, sprintRow, async (rows) => {
                const named = await names.resolver(ctx, { projectIds: [String(project._id)] });
                return rows.map((s) => ({ ref: `sprint:${s._id}`, ...sprintRow(s), project: named.project(String(project._id)) }));
            });
        },
    },
    {
        name: 'statuses.list',
        action: 'statuses.list',
        description: 'The statuses a project defines, in board order, with their type (a "close" type means done).',
        input: { type: 'object', properties: PROJECT_ARG, required: ['projectId'] },
        visibility: 'filtered',
        readParams: projectParams,
        run: async (ctx, args, vis) => {
            const project = await loadProject(ctx, vis, args.projectId);
            if (!project) return { ...NO_PROJECT };
            const out = { projectId: String(project._id), statuses: statusRows(project) };
            if (!v2.enabled()) return out;
            return { ...out, project: { id: out.projectId, name: project.ProjectName || null } };
        },
    },
    {
        name: 'comments.list',
        action: 'comments.list',
        description: 'The comment thread of a task you can open, newest first.',
        input: { type: 'object', properties: { taskId: { type: 'string' }, ...LIMIT }, required: ['taskId'] },
        visibility: 'filtered',
        paginated: true,
        run: async (ctx, args, vis) => {
            const task = isId(args.taskId)
                ? await findOne(ctx, SCHEMA_TYPE.TASKS, { _id: oid(String(args.taskId)), deletedStatusKey: { $ne: 1 } }, { ProjectID: 1, sprintId: 1 })
                : null;
            if (!vis.allowsTask(task)) return { ...NO_TASK };
            const filter = { taskId: oid(String(task._id)), isDeleted: { $ne: true } };
            return listOf(ctx, 'comments.list', args, 'comments', { type: SCHEMA_TYPE.COMMENTS, filter, sort: { createdAt: -1, _id: -1 } }, commentRow, async (rows) => {
                const projectId = idOf(task.ProjectID);
                const named = await names.resolver(ctx, { projectIds: [projectId], userIds: rows.map((c) => c.userId).filter(isId) });
                return rows.map((c) => ({ ref: `comment:${c._id}`, ...commentRow(c), author: isId(c.userId) ? named.person(String(c.userId), projectId) : { id: idOf(c.userId), name: null } }));
            });
        },
    },
    {
        name: 'pages.search',
        action: 'pages.search',
        description: 'Pages you can open, by title, most recently updated first. Read one with page.get.',
        input: { type: 'object', properties: { query: { type: 'string', description: 'Part of the page title' }, ...PROJECT_ARG, ...LIMIT } },
        visibility: 'filtered',
        paginated: true,
        readParams: projectParams,
        run: async (ctx, args, vis) => {
            const filter = { deletedStatusKey: { $ne: 1 }, ...vis.pageClause() };
            if (args.projectId !== undefined && args.projectId !== '') {
                if (!isId(args.projectId) || !vis.allowsProject(args.projectId)) return { pages: [] };
                filter.ProjectID = oid(String(args.projectId));
            }
            if (args.query) filter.title = { $regex: escapeRegex(str(args.query, 120)), $options: 'i' };
            const fields = { title: 1, ProjectID: 1, visibility: 1, createdBy: 1, updatedAt: 1 };
            return listOf(ctx, 'pages.search', args, 'pages', { type: SCHEMA_TYPE.PAGES, filter, sort: { updatedAt: -1, _id: -1 }, fields }, pageRow, async (rows) => {
                const named = await names.resolver(ctx, { projectIds: rows.map((p) => idOf(p.ProjectID)).filter(Boolean) });
                return rows.map((p) => ({ ref: `page:${p._id}`, ...pageRow(p), project: p.ProjectID ? named.project(idOf(p.ProjectID)) : null }));
            });
        },
    },
    {
        name: 'page.get',
        action: 'page.get',
        description: 'Read a page you can open, by page id: its title, project and full text.',
        input: { type: 'object', properties: { pageId: { type: 'string' } }, required: ['pageId'] },
        visibility: 'filtered',
        readParams: () => ({}),
        run: async (ctx, args, vis) => {
            const page = isId(args.pageId) ? await findOne(ctx, SCHEMA_TYPE.PAGES, { _id: oid(String(args.pageId)), deletedStatusKey: { $ne: 1 } }) : null;
            if (!page || !vis.allowsPage(page)) return { ...NO_PAGE };
            const out = { ...pageRow(page), text: str(pageText(page), PAGE_TEXT_MAX) };
            return v2.enabled() ? { ...(await names.forPage(ctx, page)), ...out } : out;
        },
    },
    {
        name: 'timesheet.read',
        action: 'timesheet.read',
        description: 'Time entries, newest first: your own by default. Another person\'s only where the timesheet screens would show them to you.',
        input: {
            type: 'object',
            properties: {
                userId: { type: 'string', description: 'Whose entries; yours when left out' },
                from: { type: 'string', description: 'First day, YYYY-MM-DD (UTC)' },
                to: { type: 'string', description: 'Last day, YYYY-MM-DD (UTC)' },
                ...PROJECT_ARG,
                ...LIMIT,
            },
        },
        visibility: 'filtered',
        paginated: true,
        readParams: () => ({}),
        run: async (ctx, args, vis) => {
            const uid = String(ctx.userId);
            const target = args.userId ? str(args.userId, 40) : uid;
            let sheetVisible = null;
            if (target !== uid) {
                const sheet = await resolveSheetScope(ctx.companyId, uid, SHEET_PERMISSION.user);
                if (!sheet.everyone || !isId(target)) {
                    throw await actions.refusal(ctx.companyId, ctx.actor, {
                        action: 'timesheet.read', params: { userId: target }, ip: ctx.ip, entityType: 'user', entityId: target,
                        reason: `${NOT_VISIBLE}: another person's time entries are not ones the person behind this token can open`,
                    });
                }
                sheetVisible = sheet.visible;
            }
            const { range, error } = dayRange(args);
            if (error) return { error };
            const filter = { Loggeduser: target };
            const projects = entryProjects(ctx, vis, args, sheetVisible);
            if (projects !== null) filter.ProjectId = { $in: projects };
            if (range) filter.LogStartTime = range;
            const out = await listOf(ctx, 'timesheet.read', args, 'entries', { type: SCHEMA_TYPE.TIMESHEET, filter, sort: { LogStartTime: -1, _id: -1 } }, entryRow, async (rows) => {
                const named = await names.resolver(ctx, { projectIds: rows.map((e) => idOf(e.ProjectId)), userIds: [target] });
                return rows.map((e) => ({ ref: `timesheet:${e._id}`, ...entryRow(e), project: named.project(idOf(e.ProjectId)), person: named.person(target, idOf(e.ProjectId)) }));
            });
            return { userId: target, ...out };
        },
    },
    {
        name: 'comment.create',
        action: 'comment.create',
        visibility: 'filtered',
        target: (args) => ({ taskId: str(args.taskId, 40) }),
        description: 'Comment on a task you can open. The text is stored as plain text, as the web app stores it.',
        input: { type: 'object', properties: { taskId: { type: 'string' }, text: { type: 'string' } }, required: ['taskId', 'text'] },
        params: (args) => ({ taskId: str(args.taskId, 40), body: str(args.text, 20000) }),
    },
    {
        name: 'timelog.create',
        action: 'timelog.create',
        visibility: 'filtered',
        target: (args) => ({ taskId: str(args.taskId, 40) }),
        description: 'Log time you spent on a task you can open, as a finished entry. It is always your own time; a day in an approved timesheet period is refused.',
        input: {
            type: 'object',
            properties: {
                taskId: { type: 'string' },
                minutes: { type: 'integer', minimum: 1, maximum: 1440 },
                date: { type: 'string', description: 'YYYY-MM-DD (UTC); today when left out' },
                startTime: { type: 'string', description: 'HH:MM (UTC); 09:00 when left out' },
                description: { type: 'string' },
                billable: { type: 'boolean' },
            },
            required: ['taskId', 'minutes'],
        },
        params: (args) => ({
            taskId: str(args.taskId, 40),
            minutes: Number(args.minutes),
            date: str(args.date, 10),
            startTime: str(args.startTime, 5),
            description: str(args.description, 500),
            billable: args.billable !== false,
        }),
    },
];

const SCOPES = Object.freeze({
    'projects.list': 'projects:read',
    'project.get': 'projects:read',
    'sprints.list': 'projects:read',
    'statuses.list': 'projects:read',
    'comments.list': 'tasks:read',
    'pages.search': 'docs:read',
    'page.get': 'docs:read',
    'timesheet.read': 'time:read',
    'comment.create': 'tasks:write',
    'timelog.create': 'time:write',
});

const offered = () => TOOLS.filter((t) => registry.has(t.action));

module.exports = { TOOLS, SCOPES, offered };

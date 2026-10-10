const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const registry = require('../Agents/registry');
const actions = require('../Agents/actions');
const { oid } = require('../Automations/engine/tools');
const { resolveSheetScope, SHEET_PERMISSION } = require('../TimeSheet/helpers/timeScope');
const { NOT_VISIBLE, TASK_ACCESS_FIELDS } = require('./visibility');
const { ownOrNotPersonal, isSomeoneElsesPersonalList } = require('../PersonalList/ownership');
const v2 = require('./v2Flag');
const cursor = require('./cursor');
const names = require('./names');
const { PAGE_TEXT_MAX, pageText } = require('./pageText');
const { MENTIONS, REPLY_TO, replyParams } = require('./commentReply');
const pageVersions = require('../Pages/helpers/pageVersions');
const versionRules = require('../Pages/helpers/pageVersionRules');
const { taskIdMatch } = require('../Comments/helpers/taskIdMatch');
const { idForms } = require('../../utils/mongo-handler/objectIdKeys');

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

const loadProject = async (ctx, vis, projectId) => {
    if (!isId(projectId) || !vis.allowsProject(projectId)) return null;
    const project = await findOne(ctx, SCHEMA_TYPE.PROJECTS, { _id: oid(projectId), deletedStatusKey: { $nin: [1] } });
    if (!project || isSomeoneElsesPersonalList(project, ctx.userId)) return null;
    return project;
};

const NO_PROJECT = Object.freeze({ error: 'That project was not found. Ask the person which project they mean.' });
const NO_TASK = Object.freeze({ error: 'That task was not found. Ask the person which task they mean.' });
const NO_PAGE = Object.freeze({ error: 'That doc was not found. Ask the person which doc they mean.' });
const NO_VERSION = Object.freeze({ error: 'That version of the doc was not found. List the doc\'s versions and pick one of those.' });

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
    ...(c.parentId ? { replyTo: idOf(c.parentId) } : {}),
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

const versionRow = (v, named, projectId) => ({
    versionId: v._id,
    title: v.title,
    name: v.name,
    reason: v.reason,
    savedAt: v.savedAt,
    savedBy: isId(v.savedBy) ? named.person(v.savedBy, projectId) : { id: v.savedBy, name: null },
});

/* A doc the person can open, as page.get reads it. */
const openPage = async (ctx, vis, pageId) => {
    const page = isId(pageId) ? await findOne(ctx, SCHEMA_TYPE.PAGES, { _id: oid(String(pageId)), deletedStatusKey: { $ne: 1 } }) : null;
    return page && vis.allowsPage(page) ? page : null;
};

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
    if (vis.projectIds) narrow(vis.projectIds.map(String));
    else if (Array.isArray(ctx.projectIds) && ctx.projectIds.length) narrow(ctx.projectIds.map(String));
    if (args.projectId !== undefined && args.projectId !== '') narrow(vis.allowsProject(args.projectId) ? [String(args.projectId)] : []);
    return allowed;
};

const dayRange = (args) => {
    const from = args.from ? String(args.from) : '';
    const to = args.to ? String(args.to) : '';
    if ((from && !DAY.test(from)) || (to && !DAY.test(to))) return { error: 'The first and the last day must be written YYYY-MM-DD.' };
    const range = {};
    if (from) range.$gte = Date.parse(`${from}T00:00:00Z`) / 1000;
    if (to) range.$lte = Date.parse(`${to}T00:00:00Z`) / 1000 + DAY_SECONDS - 1;
    if (Object.values(range).some((v) => !Number.isFinite(v))) return { error: 'The first and the last day must be written YYYY-MM-DD.' };
    return { range: Object.keys(range).length ? range : null };
};

/* Every tool is a registry action registered only while MCP_TOOLS_DATA is on, and each reads
 * through the caller's filter or names its write target so tools.call checks it first. */
const TOOLS = [
    {
        name: 'projects.list',
        action: 'projects.list',
        description: 'Lists the projects the person can open, by name. Use a projectId from here with the other tools. Changes nothing.',
        input: { type: 'object', properties: { query: { type: 'string', description: 'Part of the project name' }, ...LIMIT } },
        visibility: 'filtered',
        paginated: true,
        readParams: () => ({}),
        run: async (ctx, args, vis) => {
            const filter = { deletedStatusKey: { $nin: [1] }, $and: [ownOrNotPersonal(ctx.userId)] };
            if (vis.projectIds !== null) filter._id = { $in: oids(vis.projectIds) };
            if (args.query) filter.ProjectName = { $regex: escapeRegex(str(args.query, 120)), $options: 'i' };
            return listOf(ctx, 'projects.list', args, 'projects', { type: SCHEMA_TYPE.PROJECTS, filter, sort: { ProjectName: 1, _id: 1 } }, projectRow,
                async (rows) => rows.map((p) => ({ ref: `project:${p._id}`, ...projectRow(p) })));
        },
    },
    {
        name: 'project.get',
        action: 'project.get',
        description: 'Shows one project: its name, key, whether it is private, its members and how many statuses it has. Changes nothing.',
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
        description: 'Shows the lists of one project. A private list is shown only to the people on it, and to owners and admins. Changes nothing.',
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
        description: 'Shows the statuses a project uses, in board order, with the type of each. A "close" type means the task is done. Changes nothing.',
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
        name: 'views.list',
        action: 'views.list',
        description: 'Shows the saved views of a project that the person sees: the shared ones and their own private ones, each with its name, kind, grouping, sorting, filters and a link. '
            + 'Read it before you add a view or tell the person a view does not exist. Changes nothing.',
        input: { type: 'object', properties: PROJECT_ARG, required: ['projectId'] },
        visibility: 'filtered',
        readParams: projectParams,
        run: async (ctx, args, vis) => {
            const project = await loadProject(ctx, vis, args.projectId);
            if (!project) return { ...NO_PROJECT };
            const member = await findOne(ctx, SCHEMA_TYPE.COMPANY_USERS, { userId: String(ctx.userId) }, { ProjectRequiredComponent: 1 });
            const views = require('../Agents/setupRequests').savedViews(ctx.companyId, project, member && member.ProjectRequiredComponent);
            return { projectId: String(project._id), project: { id: String(project._id), name: project.ProjectName || null }, views };
        },
    },
    {
        name: 'comments.list',
        action: 'comments.list',
        description: 'Shows the comments on a task the person can open, newest first. Changes nothing.',
        input: { type: 'object', properties: { taskId: { type: 'string' }, ...LIMIT }, required: ['taskId'] },
        visibility: 'filtered',
        paginated: true,
        run: async (ctx, args, vis) => {
            const task = isId(args.taskId)
                ? await findOne(ctx, SCHEMA_TYPE.TASKS, { _id: oid(String(args.taskId)), deletedStatusKey: { $ne: 1 } }, TASK_ACCESS_FIELDS)
                : null;
            if (!vis.allowsTask(task)) return { ...NO_TASK };
            const filter = { taskId: taskIdMatch(task._id), isDeleted: { $ne: true } };
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
        description: 'Finds docs the person can open, by title, most recently updated first. Read one with page.get. Changes nothing.',
        input: { type: 'object', properties: { query: { type: 'string', description: 'Part of the doc title' }, ...PROJECT_ARG, ...LIMIT } },
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
        description: 'Shows one doc the person can open, given its id: its title, project and full text. Changes nothing.',
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
        name: 'page.versions.list',
        action: 'page.versions.list',
        description: 'Lists the saved versions of a doc the person can open, newest first: who saved each one, when, why, and its name if it has one. When nextCursor comes back, pass it as cursor for older versions. Read one with page.version.get. Changes nothing. Putting an earlier version back is for the person to do in AlianHub.',
        input: { type: 'object', properties: { pageId: { type: 'string' }, cursor: { type: 'string', description: 'The nextCursor of the previous page, for older versions' }, ...LIMIT }, required: ['pageId'] },
        visibility: 'filtered',
        readParams: () => ({}),
        run: async (ctx, args, vis) => {
            const page = await openPage(ctx, vis, args.pageId);
            if (!page) return { ...NO_PAGE };
            // A doc keeps far fewer versions than rowsOf reads, so every one the person may see is paged here.
            const visible = (await pageVersions.rowsOf(ctx.companyId, page._id)).filter((v) => versionRules.versionVisibleTo(v, page, ctx.userId));
            const { rows, nextCursor } = await cursor.page(ctx, 'page.versions.list', args, ({ skip, limit }) => visible.slice(skip, skip + limit));
            const projectId = idOf(page.ProjectID);
            const named = await names.resolver(ctx, { projectIds: projectId ? [projectId] : [], userIds: rows.map((v) => String(v.savedBy || '')).filter(isId) });
            const versions = rows.map((v) => versionRow(versionRules.versionRow(v), named, projectId));
            return nextCursor ? { pageId: String(page._id), versions, nextCursor } : { pageId: String(page._id), versions };
        },
    },
    {
        name: 'page.version.get',
        action: 'page.version.get',
        description: 'Shows one saved version of a doc the person can open: who saved it, when, and its full text as it was then. Changes nothing.',
        input: { type: 'object', properties: { pageId: { type: 'string' }, versionId: { type: 'string' } }, required: ['pageId', 'versionId'] },
        visibility: 'filtered',
        readParams: () => ({}),
        run: async (ctx, args, vis) => {
            const page = await openPage(ctx, vis, args.pageId);
            if (!page) return { ...NO_PAGE };
            const version = await pageVersions.versionOf(ctx.companyId, page._id, str(args.versionId, 40));
            if (!versionRules.versionVisibleTo(version, page, ctx.userId)) return { ...NO_VERSION };
            const body = versionRules.versionBody(version);
            const projectId = idOf(page.ProjectID);
            const named = await names.resolver(ctx, { projectIds: projectId ? [projectId] : [], userIds: isId(body.savedBy) ? [body.savedBy] : [] });
            return { pageId: String(page._id), ...versionRow(body, named, projectId), text: str(body.rawText, PAGE_TEXT_MAX) };
        },
    },
    {
        name: 'timesheet.read',
        action: 'timesheet.read',
        description: 'Shows time entries, newest first: the person\'s own by default. Someone else\'s are shown only where the web app\'s timesheet screens would show them to the person. Changes nothing.',
        input: {
            type: 'object',
            properties: {
                userId: { type: 'string', description: 'Whose entries; the person\'s own when left out' },
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
            let closedTasks = [];
            if (target !== uid) {
                const sheet = await resolveSheetScope(ctx.companyId, uid, SHEET_PERMISSION.user);
                if (!sheet.everyone || !isId(target)) {
                    throw await actions.refusal(ctx.companyId, ctx.actor, {
                        action: 'timesheet.read', params: { userId: target }, ip: ctx.ip, entityType: 'user', entityId: target,
                        reason: `${NOT_VISIBLE}: you can read only the person's own time entries here. Ask the person to open the timesheet in AlianHub for someone else's.`,
                    });
                }
                sheetVisible = sheet.visible;
                closedTasks = sheet.closedTasks || [];
            }
            const { range, error } = dayRange(args);
            if (error) return { error };
            const filter = { Loggeduser: target };
            const projects = entryProjects(ctx, vis, args, sheetVisible);
            if (projects !== null) filter.ProjectId = { $in: idForms(projects) };
            else if (vis.excludedProjectIds.length) filter.ProjectId = { $nin: idForms(vis.excludedProjectIds) };
            if (range) filter.LogStartTime = range;
            if (closedTasks.length) filter.TicketID = { $nin: idForms(closedTasks) };
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
        description: `Adds a comment to a task the person can open, at once, and the person can undo it. The text is saved as plain text. ${MENTIONS} ${REPLY_TO}`,
        input: { type: 'object', properties: { taskId: { type: 'string' }, text: { type: 'string' }, replyTo: { type: 'string' } }, required: ['taskId', 'text'] },
        params: (args) => ({ taskId: str(args.taskId, 40), body: str(args.text, 20000), notifyMentions: true, ...replyParams(args) }),
    },
    {
        name: 'timelog.create',
        action: 'timelog.create',
        visibility: 'filtered',
        target: (args) => ({ taskId: str(args.taskId, 40) }),
        description: 'Logs time the person spent on a task they can open, as a finished entry, at once. It is always the person\'s own time, and time cannot be logged on a day in an approved timesheet period.',
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
    'views.list': 'projects:read',
    'comments.list': 'tasks:read',
    'pages.search': 'docs:read',
    'page.get': 'docs:read',
    'page.versions.list': 'docs:read',
    'page.version.get': 'docs:read',
    'timesheet.read': 'time:read',
    'comment.create': 'tasks:write',
    'timelog.create': 'time:write',
});

const offered = () => TOOLS.filter((t) => registry.has(t.action));

module.exports = { TOOLS, SCOPES, offered, listOf, loadProject, NO_PROJECT, NO_TASK, NO_PAGE };

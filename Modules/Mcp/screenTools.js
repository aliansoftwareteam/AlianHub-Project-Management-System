const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const registry = require('../Agents/registry');
const { oid } = require('../Automations/engine/tools');
const setup = require('../Agents/setupRequests');
const { TASK_ACCESS_FIELDS } = require('./visibility');
const { loadProject } = require('./dataTools');
const { LOOK } = require('./setupTools');

const ACTION = 'screen.link';
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const WEB_ADDRESS = /^https?:\/\/[^\s/?#]+/i;

/* The `tab` the project screen reads from its address (frontend/src/views/Projects/Projects.vue). */
const VIEWS = Object.freeze({
    list: 'ProjectListView', board: 'ProjectKanban', calendar: 'Calendar', gantt: 'GanttView',
    table: 'TableView', workload: 'Workload', dashboard: 'ProjectDashboard', activity: 'ActivityLog',
});
const PLACES = Object.freeze({ home: '', everything: '/everything', projects: '/project', inbox: '/inbox', planner: '/planner', docs: '/pages', goals: '/goals' });
const THINGS = Object.freeze(['task', 'project', 'list', 'doc']);

const NOT_FOUND = Object.freeze({ error: 'That place was not found, or the person cannot open it.' });
const NO_ADDRESS = Object.freeze({ error: 'This AlianHub has no web address set, so no link can be given. Tell the person where to look instead.' });
const WORKLOAD_NOTE = 'The workload view opens on the current week.';
/* The web app reads a view's grouping and filters from a saved view, and "mine" from the address of the everything screen alone. */
const SHOWN = Object.freeze(['groupBy', 'mine', 'statuses', 'priorities', 'due', 'dueFrom', 'dueTo']);
const SAVED_VIEW = 'view.create';

const isId = (v) => OBJECT_ID.test(String(v || ''));
const findOne = (ctx, type, filter, fields) => MongoDbCrudOpration(ctx.companyId, { type, data: [filter, fields || null] }, 'findOne');

/* Only the address this server was set up with: a request's own headers name whatever host the caller chose. */
const webBase = () => {
    const base = String(process.env.WEBURL || process.env.APIURL || '').trim().replace(/\/+$/, '');
    return WEB_ADDRESS.test(base) ? base : '';
};

const onView = (path, view) => (VIEWS[view] ? `${path}?tab=${VIEWS[view]}` : path);

const projectPlace = async (ctx, args, vis) => {
    const project = await loadProject(ctx, vis, args.projectId);
    return project ? { project, path: `/project/${project._id}/p` } : null;
};

const listPlace = async (ctx, args, vis) => {
    if (!isId(args.sprintId) || !vis.allowsSprint(args.sprintId)) return null;
    const list = await findOne(ctx, SCHEMA_TYPE.SPRINTS, { _id: oid(String(args.sprintId)), deletedStatusKey: { $ne: 1 } }, { projectId: 1, folderId: 1 });
    if (!list || (args.projectId !== undefined && String(args.projectId) !== String(list.projectId))) return null;
    const project = await loadProject(ctx, vis, String(list.projectId));
    if (!project) return null;
    const inFolder = isId(list.folderId) ? `fs/${list.folderId}` : 's';
    return { project, path: `/project/${project._id}/${inFolder}/${list._id}` };
};

const taskAddress = (task) => (isId(task.sprintId)
    ? `/project/${task.ProjectID}/s/${task.sprintId}/${task._id}?detailTab=task-detail-tab`
    : `/project/${task.ProjectID}/p`);

const taskPlace = async (ctx, args, vis) => {
    if (!isId(args.taskId)) return null;
    const task = await findOne(ctx, SCHEMA_TYPE.TASKS, { _id: oid(String(args.taskId)), deletedStatusKey: { $ne: 1 } }, TASK_ACCESS_FIELDS);
    if (!vis.allowsTask(task) || !(await loadProject(ctx, vis, String(task.ProjectID)))) return null;
    return { path: taskAddress(task) };
};

const docPlace = async (ctx, args, vis) => {
    if (!isId(args.pageId)) return null;
    const page = await findOne(ctx, SCHEMA_TYPE.PAGES, { _id: oid(String(args.pageId)), deletedStatusKey: { $ne: 1 } }, { ProjectID: 1, visibility: 1, createdBy: 1, sharedWith: 1 });
    return page && vis.allowsPage(page) ? { path: `/pages/${page._id}` } : null;
};

const THINGS_AT = Object.freeze({ task: taskPlace, project: projectPlace, list: listPlace, doc: docPlace });
const takesView = (screen) => screen === 'project' || screen === 'list';

const askedOf = (args) => SHOWN.filter((key) => (key === 'mine' ? args.mine === true : args[key] !== undefined));

const groupKey = (value) => String(value).trim().toLowerCase().replace(/\s+/g, '_');
/* A grouping named the way the person says it ("Stage", "Priority") rather than by key or id is looked up when the link is made. */
const namesAField = (value) => value !== undefined && !isId(value) && !Object.hasOwn(setup.GROUPS, groupKey(value));

const checkedGroup = (args) => {
    if (args.groupBy === undefined || isId(args.groupBy)) return args;
    const { groupBy, ...rest } = args;
    return namesAField(groupBy) ? rest : { ...rest, groupBy: groupKey(groupBy) };
};

const shownProblem = (given) => {
    const args = checkedGroup(given);
    const asked = askedOf(given);
    if (!asked.length) return '';
    const screen = String(args.screen);
    if (screen === 'everything') return asked.every((key) => key === 'mine') ? '' : 'a link to the everything screen carries only mine; its grouping and filters are picked on the page';
    if (!takesView(screen)) return `${asked.join(', ')} can be asked only of a project, a list or the everything screen`;
    if (args.view !== undefined && !Object.hasOwn(setup.VIEW_KINDS, String(args.view))) return `a ${args.view} view opens as it is; a grouping, mine and filters are for ${Object.keys(setup.VIEW_KINDS).join(', ')}`;
    return setup.lookProblem(args);
};

const notSaved = (kind, offer) => `No saved view of this project shows its ${kind} view that way, and a link carries no grouping or filter of its own, so this one opens the ${kind} view as it is.`
    + (offer
        ? ' Do not list the tasks in the chat in its place: offer to save this view, and when the person agrees send view.create with saveView.arguments. It waits for their approval once; then the link opens on it.'
        : '');

const fieldsNamed = async (ctx, project, name) => {
    const { isTaskFieldOf } = require('../CustomField/helpers/fieldValueInput');
    const rows = await MongoDbCrudOpration(ctx.companyId, { type: SCHEMA_TYPE.CUSTOM_FIELDS, data: [{ type: 'task', isDelete: { $ne: false } }, { fieldTitle: 1, fieldType: 1, type: 1, isDelete: 1, global: 1, projectId: 1 }] }, 'find') || [];
    const wanted = String(name).trim().toLowerCase();
    return rows.filter((row) => isTaskFieldOf(row, project._id) && String(row.fieldTitle || '').trim().toLowerCase() === wanted);
};

/* The grouping asked for, as a key or a field id, with the words a view's name uses for it; or why there is none. */
const groupingOf = async (ctx, project, value) => {
    if (value === undefined) return { label: '' };
    if (isId(value)) {
        const { isTaskFieldOf } = require('../CustomField/helpers/fieldValueInput');
        const field = await findOne(ctx, SCHEMA_TYPE.CUSTOM_FIELDS, { _id: oid(String(value)) }, { fieldTitle: 1, fieldType: 1, type: 1, isDelete: 1, global: 1, projectId: 1 });
        if (!isTaskFieldOf(field, project._id)) return { problem: { error: `This project has no field with the id ${value}. Look its fields up with fields.list.` } };
        return { groupBy: String(value), label: field.fieldTitle || '' };
    }
    if (!namesAField(value)) return { groupBy: groupKey(value), label: groupKey(value).replace(/_/g, ' ') };
    const found = await fieldsNamed(ctx, project, value);
    if (!found.length) return { problem: { error: `This project has no field named "${value}". Look its fields up with fields.list, or group by ${Object.keys(setup.GROUPS).join(', ')}.` } };
    if (found.length > 1) {
        return { problem: {
            error: `More than one field of this project is named "${value}". Ask the person which one they mean, or pick by type, and give its fieldId as groupBy.`,
            fields: found.map((row) => ({ fieldId: String(row._id), name: row.fieldTitle, type: row.fieldType })),
        } };
    }
    return { groupBy: String(found[0]._id), label: found[0].fieldTitle };
};

const savingIt = (project, kind, args, label) => ({
    tool: SAVED_VIEW,
    arguments: {
        projectId: String(project._id), name: label ? `By ${label}` : 'Filtered', kind,
        ...Object.fromEntries(SHOWN.filter((key) => args[key] !== undefined && (key !== 'mine' || args.mine === true)).map((key) => [key, args[key]])),
    },
});

/* A project or a list asked for grouped, filtered or on the person's own tasks: the saved view that shows it, or the plain view and why. */
const asShown = async (ctx, place, given) => {
    const grouping = await groupingOf(ctx, place.project, given.groupBy);
    if (grouping.problem) return grouping;
    const args = grouping.groupBy === undefined ? given : { ...given, groupBy: grouping.groupBy };
    const kind = args.view === undefined ? 'list' : String(args.view);
    const path = onView(place.path, kind);
    const saved = await setup.savedViewShowing(ctx.companyId, place.project, kind, args);
    if (saved) return { path: `${path}&view=${setup.viewIdOf(saved)}`, view: kind, savedView: saved.title || '' };
    const offer = require('./tools').usable(ctx).some((tool) => tool.name === SAVED_VIEW);
    return { path, view: kind, note: notSaved(kind, offer), ...(offer ? { saveView: savingIt(place.project, kind, args, grouping.label) } : {}) };
};

const placeOf = async (ctx, args, vis) => {
    const screen = String(args.screen);
    const place = THINGS_AT[screen] ? await THINGS_AT[screen](ctx, args, vis) : { path: PLACES[screen] };
    if (!place || place.path === undefined) return null;
    const asked = askedOf(args).length > 0;
    if (asked && takesView(screen)) return asShown(ctx, place, args);
    if (asked) return { path: `${place.path}?mine=1`, mine: true };
    const view = takesView(screen) && VIEWS[args.view] ? String(args.view) : '';
    return { path: onView(place.path, view), ...(view ? { view } : {}), ...(view === 'workload' ? { note: WORKLOAD_NOTE } : {}) };
};

const ID_ARG = { type: 'string', maxLength: 40 };

const TOOLS = [
    {
        name: ACTION,
        action: ACTION,
        description: 'Gives the web address of a place in AlianHub, to share when the person asks "show me" or "where do I see this". Changes nothing. '
            + 'Say what to open: a task (taskId), a project (projectId), a list (sprintId), a doc (pageId), or one of the main screens: '
            + 'home (the person\'s own tasks for today), everything (all tasks across projects), projects, inbox, planner, docs, goals. '
            + 'A project or a list can open on one view: list, board, calendar, gantt, table, workload (who has how much work this week), dashboard or activity. '
            + 'If you ask for a grouping, a filter or mine, it opens on the saved view that already shows it that way, named in savedView; if there is none, you get the plain link with a note. The everything screen takes mine. '
            + 'When the person asks to see a list grouped or filtered ("show me this list grouped by Stage"), use this with the list they have open, not a table of its tasks; groupBy takes a field\'s name as the person says it. '
            + 'It answers only for something the person can open; for anything else it says the place was not found.',
        input: {
            type: 'object',
            properties: {
                screen: { type: 'string', enum: [...THINGS, ...Object.keys(PLACES)] },
                taskId: ID_ARG,
                projectId: ID_ARG,
                sprintId: { ...ID_ARG, description: 'The id of a list' },
                pageId: { ...ID_ARG, description: 'The id of a doc' },
                view: { type: 'string', enum: Object.keys(VIEWS), description: 'For a project or a list' },
                ...Object.fromEntries(SHOWN.map((key) => [key, LOOK[key]])),
                groupBy: { type: 'string', maxLength: 80, description: `One of ${Object.keys(setup.GROUPS).join(', ')}, or a custom field by its name or id` },
                mine: { type: 'boolean', description: 'Only the person\'s own tasks' },
            },
            required: ['screen'],
        },
        strict: true,
        visibility: 'filtered',
        readParams: (args) => ({ ...(isId(args.projectId) ? { projectId: String(args.projectId) } : {}), ...(isId(args.taskId) ? { taskId: String(args.taskId) } : {}) }),
        check: shownProblem,
        run: async (ctx, args, vis) => {
            const base = webBase();
            if (!base) return { ...NO_ADDRESS };
            const place = await placeOf(ctx, args, vis);
            if (!place) return { ...NOT_FOUND };
            if (place.problem) return place.problem;
            const { path, ...rest } = place;
            return { url: `${base}/#/${encodeURIComponent(String(ctx.companyId))}${path}`, screen: String(args.screen), ...rest };
        },
    },
];

const SCOPES = Object.freeze({ [ACTION]: 'projects:read' });

const offered = () => TOOLS.filter((tool) => registry.has(tool.action));

module.exports = { TOOLS, SCOPES, ACTION, VIEWS, PLACES, offered, webBase, taskAddress };

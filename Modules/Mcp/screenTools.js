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

const NOT_FOUND = Object.freeze({ error: 'not found' });
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

const shownProblem = (args) => {
    const asked = askedOf(args);
    if (!asked.length) return '';
    const screen = String(args.screen);
    if (screen === 'everything') return asked.every((key) => key === 'mine') ? '' : 'a link to the everything screen carries only mine; its grouping and filters are picked on the page';
    if (!takesView(screen)) return `${asked.join(', ')} can be asked only of a project, a list or the everything screen`;
    if (args.view !== undefined && !Object.hasOwn(setup.VIEW_KINDS, String(args.view))) return `a ${args.view} view opens as it is; a grouping, mine and filters are for ${Object.keys(setup.VIEW_KINDS).join(', ')}`;
    return setup.lookProblem(args);
};

const notSaved = (kind) => `No saved view of this project shows its ${kind} view that way, and a link carries no grouping or filter of its own, so this one opens the ${kind} view as it is.`
    + (registry.has(SAVED_VIEW) ? ` ${SAVED_VIEW} adds a saved view that does, once the person approves it.` : '');

/* A project or a list asked for grouped, filtered or on the person's own tasks: the saved view that shows it, or the plain view and why. */
const asShown = async (ctx, place, args) => {
    const kind = args.view === undefined ? 'list' : String(args.view);
    const path = onView(place.path, kind);
    const saved = await setup.savedViewShowing(ctx.companyId, place.project, kind, args);
    return saved
        ? { path: `${path}&view=${setup.viewIdOf(saved)}`, view: kind, savedView: saved.title || '' }
        : { path, view: kind, note: notSaved(kind) };
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
        description: 'The web address of a place in AlianHub, to give the person when they ask "show me" or "where do I see this". '
            + 'Say what to open: a task (taskId), a project (projectId), a list (sprintId), a doc (pageId), or one of the main screens: '
            + 'home (the person\'s own tasks for today), everything (all tasks across projects), projects, inbox, planner, docs, goals. '
            + 'A project or a list can open on one view: list, board, calendar, gantt, table, workload (who has how much work, this week), dashboard or activity. '
            + 'Asked for a grouping, a filter or mine, a project or a list opens on the saved view that already shows it that way, named in savedView; '
            + 'with none, the plain link comes back with a note, since a link carries no grouping of its own. The everything screen takes mine. '
            + 'It answers only for a thing the person can open; anything else is "not found".',
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
            const { path, ...rest } = place;
            return { url: `${base}/#/${encodeURIComponent(String(ctx.companyId))}${path}`, screen: String(args.screen), ...rest };
        },
    },
];

const SCOPES = Object.freeze({ [ACTION]: 'projects:read' });

const offered = () => TOOLS.filter((tool) => registry.has(tool.action));

module.exports = { TOOLS, SCOPES, ACTION, VIEWS, PLACES, offered, webBase, taskAddress };

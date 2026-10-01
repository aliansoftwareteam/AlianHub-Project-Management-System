const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const registry = require('../Agents/registry');
const { oid } = require('../Automations/engine/tools');
const { TASK_ACCESS_FIELDS } = require('./visibility');
const { loadProject } = require('./dataTools');

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

const isId = (v) => OBJECT_ID.test(String(v || ''));
const findOne = (ctx, type, filter, fields) => MongoDbCrudOpration(ctx.companyId, { type, data: [filter, fields || null] }, 'findOne');

/* Only the address this server was set up with: a request's own headers name whatever host the caller chose. */
const webBase = () => {
    const base = String(process.env.WEBURL || process.env.APIURL || '').trim().replace(/\/+$/, '');
    return WEB_ADDRESS.test(base) ? base : '';
};

const onView = (path, view) => (VIEWS[view] ? `${path}?tab=${VIEWS[view]}` : path);

const projectPath = async (ctx, args, vis) => {
    const project = await loadProject(ctx, vis, args.projectId);
    return project ? onView(`/project/${project._id}/p`, args.view) : null;
};

const listPath = async (ctx, args, vis) => {
    if (!isId(args.sprintId) || !vis.allowsSprint(args.sprintId)) return null;
    const list = await findOne(ctx, SCHEMA_TYPE.SPRINTS, { _id: oid(String(args.sprintId)), deletedStatusKey: { $ne: 1 } }, { projectId: 1, folderId: 1 });
    if (!list || (args.projectId !== undefined && String(args.projectId) !== String(list.projectId))) return null;
    const project = await loadProject(ctx, vis, String(list.projectId));
    if (!project) return null;
    const inFolder = isId(list.folderId) ? `fs/${list.folderId}` : 's';
    return onView(`/project/${project._id}/${inFolder}/${list._id}`, args.view);
};

const taskPath = async (ctx, args, vis) => {
    if (!isId(args.taskId)) return null;
    const task = await findOne(ctx, SCHEMA_TYPE.TASKS, { _id: oid(String(args.taskId)), deletedStatusKey: { $ne: 1 } }, TASK_ACCESS_FIELDS);
    if (!vis.allowsTask(task) || !(await loadProject(ctx, vis, String(task.ProjectID)))) return null;
    return isId(task.sprintId)
        ? `/project/${task.ProjectID}/s/${task.sprintId}/${task._id}?detailTab=task-detail-tab`
        : `/project/${task.ProjectID}/p`;
};

const docPath = async (ctx, args, vis) => {
    if (!isId(args.pageId)) return null;
    const page = await findOne(ctx, SCHEMA_TYPE.PAGES, { _id: oid(String(args.pageId)), deletedStatusKey: { $ne: 1 } }, { ProjectID: 1, visibility: 1, createdBy: 1, sharedWith: 1 });
    return page && vis.allowsPage(page) ? `/pages/${page._id}` : null;
};

const PATHS = Object.freeze({ task: taskPath, project: projectPath, list: listPath, doc: docPath });
const takesView = (screen) => screen === 'project' || screen === 'list';

const ID_ARG = { type: 'string', maxLength: 40 };

const TOOLS = [
    {
        name: ACTION,
        action: ACTION,
        description: 'The web address of a place in AlianHub, to give the person when they ask "show me" or "where do I see this". '
            + 'Say what to open: a task (taskId), a project (projectId), a list (sprintId), a doc (pageId), or one of the main screens: '
            + 'home (the person\'s own tasks for today), everything (all tasks across projects), projects, inbox, planner, docs, goals. '
            + 'A project or a list can open on one view: list, board, calendar, gantt, table, workload (who has how much work, this week), dashboard or activity. '
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
            },
            required: ['screen'],
        },
        strict: true,
        visibility: 'filtered',
        readParams: (args) => ({ ...(isId(args.projectId) ? { projectId: String(args.projectId) } : {}), ...(isId(args.taskId) ? { taskId: String(args.taskId) } : {}) }),
        run: async (ctx, args, vis) => {
            const base = webBase();
            if (!base) return { ...NO_ADDRESS };
            const screen = String(args.screen);
            const path = PATHS[screen] ? await PATHS[screen](ctx, args, vis) : PLACES[screen];
            if (path === null || path === undefined) return { ...NOT_FOUND };
            const view = takesView(screen) && VIEWS[args.view] ? String(args.view) : '';
            return {
                url: `${base}/#/${encodeURIComponent(String(ctx.companyId))}${path}`,
                screen,
                ...(view ? { view } : {}),
                ...(view === 'workload' ? { note: WORKLOAD_NOTE } : {}),
            };
        },
    },
];

const SCOPES = Object.freeze({ [ACTION]: 'projects:read' });

const offered = () => TOOLS.filter((tool) => registry.has(tool.action));

module.exports = { TOOLS, SCOPES, ACTION, VIEWS, PLACES, offered };

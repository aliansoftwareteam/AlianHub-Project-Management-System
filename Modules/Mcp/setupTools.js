const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { oid } = require('../Automations/engine/tools');
const registry = require('../Agents/registry');
const setup = require('../Agents/setupRequests');
const actions = require('../Agents/actions');
const permissions = require('../Agents/permissions');
const plans = require('../Agents/projectSetup');
const projects = require('../Agents/projectCreate');
const copies = require('../Agents/projectDuplicate');
const lists = require('../Agents/listSetup');
const { LIST_NAME_MAX } = require('../Agents/workRequests');
const manageFlag = require('./manageFlag');
const { TASK_ACCESS_FIELDS } = require('./visibility');
const { WRITE_TARGET } = require('../Goals/goalTokens');
const { loadProject } = require('./dataTools');

const { GRANT } = manageFlag;
const DENIED = permissions.REASON;

// Setting a project up: custom fields, saved views, a whole plan in one call, a new project with its plan, a copy of
// a project, a folder with its lists, or a list made a sprint. These show to everyone on the project, so a call never
// makes one: it is filed for the person to approve in AlianHub (their actions are proposeOnly, Agents/registry/setup.js,
// projectSetup.js, projectCreate.js, projectDuplicate.js and listSetup.js), and what is approved runs the web app's own
// routes (Modules/Agents/setupRequests.js, projectSetup.js, projectCreate.js, projectDuplicate.js and listSetup.js).

const RAW_OPTIONS_MAX = 100;
const RAW_TEXT_MAX = 200;

const str = (v, max = 500) => String(v === undefined || v === null ? '' : v).slice(0, max);
const ID = Object.freeze({ type: 'string', pattern: '^[a-fA-F0-9]{24}$' });
const DAY = Object.freeze({ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' });
const REASON = Object.freeze({ reason: { type: 'string', maxLength: 500, description: 'Why, in a line; it is kept in the audit log' } });
const input = (properties, required) => ({ type: 'object', additionalProperties: false, properties, required });
const projectTarget = (args) => ({ projectId: str(args.projectId, 40) });

const WAITS = 'Nothing is made by the call: it answers that the change is waiting, and the person approves it in AlianHub, where they see exactly what will be made. They can undo it afterwards.';

const FIELD = Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
        name: { type: 'string', minLength: 1, maxLength: setup.FIELD_NAME_MAX },
        type: { type: 'string', enum: [...setup.FIELD_TYPES] },
        options: {
            type: 'array', maxItems: RAW_OPTIONS_MAX, items: { type: 'string', minLength: 1, maxLength: RAW_TEXT_MAX },
            description: `For a dropdown: its options as plain text, at most ${setup.OPTIONS_MAX} of ${setup.OPTION_MAX} characters`,
        },
        description: { type: 'string', maxLength: setup.NOTE_MAX, description: 'What the field is for, in a line' },
    },
    required: ['name', 'type'],
});

const VALUE = Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
        taskId: ID,
        field: { type: 'string', minLength: 1, maxLength: RAW_TEXT_MAX, description: 'The name of a field of this call, or of one the project already has' },
        value: { description: 'The value in the field\'s type, as task.field.set takes it' },
    },
    required: ['taskId', 'field', 'value'],
});

const NO_FIELD_SET = `${DENIED}: values are set as ${setup.FIELD_SET} sets one, which this connection may not use`;

/* Values are refused at once where the caller could not set one by itself, where a task is not one of the project
 * the caller can open, or where a field would not take its value, so nobody is asked to approve a value that cannot
 * be set. A project the caller cannot open is left to the target check. */
const fieldsToFile = async (ctx, args, vis) => {
    if (args.values === undefined) return { args };
    const project = await loadProject(ctx, vis, args.projectId);
    if (!project) return { args };
    const projectId = String(project._id);
    const refuse = async (reason) => { throw await actions.refusal(ctx.companyId, ctx.actor, { action: 'fields.create', params: { projectId }, reason, ip: ctx.ip, taint: ctx.taint, entityType: 'project', entityId: projectId }); };
    const usable = registry.has(setup.FIELD_SET) && manageFlag.mayUse(ctx, GRANT)
        && registry.evaluate(setup.FIELD_SET, { __proposal: true }, { allowedActions: ctx.allowedActions }).allowed;
    if (!usable) await refuse(NO_FIELD_SET);
    const named = [...new Set(setup.valuesOf(args.values).map((value) => value.taskId))];
    const rows = await MongoDbCrudOpration(ctx.companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: { $in: named.map(oid) }, deletedStatusKey: { $ne: 1 } }, TASK_ACCESS_FIELDS] }, 'find');
    const taskIds = (rows || []).filter((task) => String(task.ProjectID) === projectId && vis.allowsTask(task)).map((task) => String(task._id));
    for (const taskId of taskIds) {
        const may = await permissions.holderMay(ctx.companyId, ctx.actor, setup.FIELD_SET, { taskId });
        if (!may.allowed) await refuse(may.reason);
    }
    const problem = await setup.valuesMisfit({ companyId: ctx.companyId, uid: String(ctx.userId), projectId, definitions: args.fields, values: args.values, taskIds });
    return problem ? { answer: { ok: false, error: problem } } : { args };
};

const LOOK = Object.freeze({
    groupBy: { type: 'string', maxLength: 24, description: `One of ${Object.keys(setup.GROUPS).join(', ')}, or the id of a custom field (see fields.list)` },
    sortBy: { type: 'string', maxLength: 24, description: `One of ${Object.keys(setup.SORTS).join(', ')}, or the id of a custom field` },
    sortDirection: { type: 'string', enum: [...setup.DIRECTIONS] },
    mine: { type: 'boolean', description: 'Show each person only their own tasks' },
    assigneeIds: { type: 'array', maxItems: setup.LOOK_MAX.assignees, items: ID, description: 'Only tasks of these members' },
    statuses: { type: 'array', maxItems: setup.LOOK_MAX.statuses, items: { type: 'string', minLength: 1, maxLength: setup.LOOK_MAX.status }, description: 'Only tasks in these statuses, by name (see statuses.list)' },
    priorities: { type: 'array', maxItems: setup.PRIORITIES.length, items: { type: 'string', enum: [...setup.PRIORITIES] } },
    due: { type: 'string', enum: Object.keys(setup.DUE), description: 'Only tasks due in this span, counted from the day the view is opened; overdue is due before today, whatever the status' },
    dueFrom: { ...DAY, description: 'Only tasks due from this day to dueTo, as YYYY-MM-DD; in place of due' },
    dueTo: DAY,
    search: { type: 'string', maxLength: setup.LOOK_MAX.search, description: 'Only tasks whose name holds this text' },
    subtasks: { type: 'string', enum: [...setup.SUBTASKS] },
    showFieldIds: { type: 'array', maxItems: setup.LOOK_MAX.columns, items: ID, description: 'Custom fields to show as columns' },
});

/* The answer when the project has no view of that kind to copy; a project the caller cannot open is left to the target check. */
const viewToStartFrom = async (ctx, args, vis) => {
    const kind = args.kind === undefined ? 'list' : String(args.kind);
    const project = await loadProject(ctx, vis, args.projectId);
    if (project && !setup.sourceView(project, kind)) return { answer: { ok: false, error: setup.noSource(kind) } };
    return { args: { ...args, kind } };
};

const REFUSED = `${DENIED}: the person behind this token may not make these parts of the plan by hand`;
const NAMES = (max, nameMax, description) => ({ type: 'array', minItems: 1, maxItems: max, items: { type: 'string', minLength: 1, maxLength: RAW_TEXT_MAX }, description: `${description}, each at most ${nameMax} characters` });

const PLAN_VIEW = Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
        name: { type: 'string', minLength: 1, maxLength: setup.VIEW_NAME_MAX },
        kind: { type: 'string', enum: Object.keys(setup.VIEW_KINDS), description: 'Left out, a list view' },
        ...LOOK,
        showFields: {
            type: 'array', maxItems: setup.LOOK_MAX.columns, items: { type: 'string', minLength: 1, maxLength: RAW_TEXT_MAX },
            description: 'Fields of this same plan to show as columns, by name; a field the project already has goes in showFieldIds',
        },
    },
    required: ['name'],
});

/* A plan is refused at once where its person may not make one of its parts by hand, or a view has nothing to start
 * from, so nobody is asked to approve a part that cannot be made. A project the caller cannot open is left to the target check. */
const planToFile = async (ctx, args, vis) => {
    const project = await loadProject(ctx, vis, args.projectId);
    if (!project) return { args };
    const plan = plans.planOf(args);
    const refused = await plans.refusedParts(ctx.companyId, ctx.userId, String(project._id), plan);
    if (refused.length) {
        const reason = `${REFUSED}: ${refused.map((entry) => `${entry.part} (${entry.reason})`).join('; ')}`;
        throw await actions.refusal(ctx.companyId, ctx.actor, { action: 'project.setup', params: { projectId: String(project._id) }, reason, ip: ctx.ip, taint: ctx.taint, entityType: 'project', entityId: String(project._id) });
    }
    const kind = (plan.views || []).map((view) => view.kind).find((wanted) => !setup.sourceView(project, wanted));
    return kind ? { answer: { ok: false, error: setup.noSource(kind) } } : { args };
};

const BY_ID_ONLY = Object.freeze(['assigneeIds', 'showFieldIds']);

/* A view of a project that is not there yet: one of the kinds a new project starts with, and nothing that names a
 * field or a person by id, which the project does not have. */
const NEW_PROJECT_VIEW = Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
        name: PLAN_VIEW.properties.name,
        kind: { type: 'string', enum: projects.viewKinds(), description: 'Left out, a list view' },
        ...Object.fromEntries(Object.entries(LOOK).filter(([key]) => !BY_ID_ONLY.includes(key))),
        groupBy: { type: 'string', enum: Object.keys(setup.GROUPS) },
        sortBy: { type: 'string', enum: Object.keys(setup.SORTS) },
        showFields: { ...PLAN_VIEW.properties.showFields, description: 'Fields of this same plan to show as columns, by name' },
    },
    required: ['name'],
});

const CANNOT_CREATE = `${DENIED}: the person behind this token may not create a project by hand`;

/* A project is refused at once where its person may not create one by hand, or may not make a part of its plan, so
 * nobody is asked to approve what could not be made. */
const projectToFile = async (ctx, args) => {
    const draft = projects.draftOf(args);
    const refused = await projects.refusedFor(ctx.companyId, ctx.userId, draft);
    const reason = (refused.project && `${CANNOT_CREATE} (${refused.project})`)
        || (refused.parts.length && `${REFUSED}: ${refused.parts.map((entry) => `${entry.part} (${entry.reason})`).join('; ')}`);
    if (reason) throw await actions.refusal(ctx.companyId, ctx.actor, { action: projects.ACTION, params: { name: draft.name }, reason, ip: ctx.ip, taint: ctx.taint, entityType: 'project' });
    return { args };
};

const copyAsked = (args) => copies.draftOf({ ...args, sourceProjectId: args.projectId });

/* A copy is refused at once where its person may not create a project by hand, and answered at once where the project
 * is a personal list or has more tasks than a copy made this way takes, so nobody is asked to approve what could not
 * be made. A project the caller cannot open is left to the target check. */
const copyToFile = async (ctx, args, vis) => {
    const draft = copyAsked(args);
    const lacked = await copies.refusedFor(ctx.companyId, ctx.userId);
    if (lacked) {
        throw await actions.refusal(ctx.companyId, ctx.actor, { action: copies.ACTION, params: { sourceProjectId: draft.sourceProjectId, name: draft.name }, reason: `${CANNOT_CREATE} (${lacked})`, ip: ctx.ip, taint: ctx.taint, entityType: 'project' });
    }
    const project = await loadProject(ctx, vis, args.projectId);
    if (!project) return { args };
    if (project.isPersonal === true) return { answer: { ok: false, error: copies.PERSONAL } };
    const large = draft.tasks ? copies.tooLarge(await copies.taskCount({ companyId: ctx.companyId, uid: ctx.userId, source: project })) : '';
    return large ? { answer: { ok: false, error: large } } : { args };
};

const FOLDER_NAME = Object.freeze({ type: 'string', minLength: 1, maxLength: lists.NAME_MAX });
const FOLDER_PARTS = Object.freeze({
    lists: NAMES(lists.LISTS_MAX, LIST_NAME_MAX, 'Lists to create inside it, by name'),
    moveListIds: { type: 'array', minItems: 1, maxItems: lists.MOVES_MAX, items: ID, description: 'Lists the project already has to move into it, by id (see lists.list)' },
});

/* A folder is refused at once where its person may not make one of its parts by hand, and answered at once where the
 * folder it goes in, or a list to move, is not one of the project that person can open, so nobody is asked to approve
 * what could not be made. A project the caller cannot open is left to the target check. */
const folderToFile = async (ctx, args, vis) => {
    const project = await loadProject(ctx, vis, args.projectId);
    if (!project) return { args };
    const projectId = String(project._id);
    const draft = lists.draftOf(args);
    const refused = await lists.refusedParts(ctx.companyId, ctx.userId, projectId, draft);
    if (refused.length) {
        const reason = `${REFUSED}: ${refused.map((entry) => `${entry.part} (${entry.reason})`).join('; ')}`;
        throw await actions.refusal(ctx.companyId, ctx.actor, { action: lists.FOLDER, params: { projectId }, reason, ip: ctx.ip, taint: ctx.taint, entityType: 'project', entityId: projectId });
    }
    const parent = draft.parentFolderId ? await lists.parentProblem(ctx.companyId, projectId, draft.parentFolderId) : '';
    if (parent) return { answer: { ok: false, error: `parentFolderId: ${parent}` } };
    for (const sprintId of [draft, ...(draft.subfolders || [])].flatMap((folder) => folder.moveListIds || [])) {
        if (!(await lists.listFor(ctx.companyId, ctx.userId, projectId, sprintId))) return { answer: { ok: false, error: `moveListIds: ${lists.LIST_NOT_FOUND} (${sprintId})` } };
    }
    return { args };
};

const TOOLS = [
    {
        name: 'fields.create',
        action: 'fields.create',
        visibility: 'filtered',
        strict: true,
        filedUnder: GRANT,
        target: projectTarget,
        description: `Add up to ${setup.FIELDS_MAX} custom fields to one project in a single call, each with a name and a type: ${setup.FIELD_TYPES.join(', ')}. `
            + 'A dropdown takes its options as plain text. A field the project already has by that name is kept, not made twice, so read fields.list first. '
            + `To give the fields their first values in the same approval, name them in values (at most ${setup.VALUES_MAX}): each a task of this project, a field by its name and the value. `
            + 'A value is set only on a task the person and the approver may both edit, and the answer says which were set. '
            + `${WAITS} Set or change a value later with task.field.set.`,
        input: input({
            projectId: ID,
            fields: { type: 'array', minItems: 1, maxItems: setup.FIELDS_MAX, items: FIELD },
            values: { type: 'array', minItems: 1, maxItems: setup.VALUES_MAX, items: VALUE },
            ...REASON,
        }, ['projectId', 'fields']),
        check: (args) => setup.draftsProblem(args.fields) || setup.valuesProblem(args.values),
        prepare: fieldsToFile,
        params: (args) => ({ projectId: str(args.projectId, 40), definitions: setup.draftsOf(args.fields), ...(args.values === undefined ? {} : { values: setup.valuesOf(args.values) }) }),
    },
    {
        name: 'view.create',
        action: 'view.create',
        visibility: 'filtered',
        strict: true,
        filedUnder: GRANT,
        target: projectTarget,
        description: `Add a saved view to one project: a ${Object.keys(setup.VIEW_KINDS).join(', ')} view with its own name, grouping, sorting, filters and columns. `
            + 'It starts as a copy of the project\'s view of that kind, and everyone on the project sees it. A status or a field the project does not have is left out, and the answer says which part. '
            + `${WAITS} To only show the person a view that exists, give them a link with screen.link instead.`,
        input: input({
            projectId: ID,
            name: { type: 'string', minLength: 1, maxLength: setup.VIEW_NAME_MAX },
            kind: { type: 'string', enum: Object.keys(setup.VIEW_KINDS), description: 'Left out, a list view' },
            ...LOOK,
            ...REASON,
        }, ['projectId', 'name']),
        check: (args) => (setup.viewNameOf(args.name) ? setup.lookProblem(args) : 'name needs some text'),
        prepare: viewToStartFrom,
        params: (args) => ({ projectId: str(args.projectId, 40), name: setup.viewNameOf(args.name), kind: str(args.kind, 20), look: setup.lookOf(args) }),
    },
    {
        name: 'project.setup',
        action: 'project.setup',
        visibility: 'filtered',
        strict: true,
        filedUnder: GRANT,
        target: projectTarget,
        description: 'Set up a project that exists from one plan, in a single call: '
            + `up to ${plans.STATUSES_MAX} statuses, ${plans.LISTS_MAX} lists, ${setup.FIELDS_MAX} custom fields and ${plans.VIEWS_MAX} saved views. Name only the parts you need. `
            + 'A status is added as a working stage, before the statuses that close a task; one the company does not have yet can be added only when an owner or an admin sends and approves the plan. '
            + 'A status or a field the project already has by that name is kept, not made twice, so read statuses.list, lists.list and fields.list first. '
            + 'It cannot make a project, an automation or a task. '
            + `${WAITS} The person sees the whole plan as one preview and approves it once; the answer then says, part by part, what was made, what was kept and what could not be made.`,
        input: input({
            projectId: ID,
            statuses: NAMES(plans.STATUSES_MAX, plans.STATUS_NAME_MAX, 'Statuses to add, by name'),
            lists: NAMES(plans.LISTS_MAX, LIST_NAME_MAX, 'Lists to create, by name'),
            fields: { type: 'array', minItems: 1, maxItems: setup.FIELDS_MAX, items: FIELD },
            views: { type: 'array', minItems: 1, maxItems: plans.VIEWS_MAX, items: PLAN_VIEW },
            ...REASON,
        }, ['projectId']),
        check: (args) => plans.planProblem(args),
        prepare: planToFile,
        params: (args) => ({ projectId: str(args.projectId, 40), ...plans.planOf(args) }),
    },
    {
        name: projects.ACTION,
        action: projects.ACTION,
        visibility: 'filtered',
        strict: true,
        filedUnder: GRANT,
        target: () => WRITE_TARGET,
        description: 'Ask for a new project, in a single call: its name, what it is for, and the plan project.setup takes, '
            + `up to ${plans.STATUSES_MAX} statuses, ${plans.LISTS_MAX} lists, ${setup.FIELDS_MAX} custom fields and ${plans.VIEWS_MAX} saved views. Name only the parts you need; the name alone is enough. `
            + `It starts as a blank project: the statuses ${projects.startingStatuses().join(', ')}, one list, and ${projects.viewKinds().join(' and ')} views. It is private, with only the person who approves it on it; they add the others afterwards. `
            + 'Use it only when the person has no project for the work: read projects.list first. It cannot make an automation or a task, and a token kept to some projects cannot use it. '
            + `${WAITS} The person sees the project and its whole plan as one preview and approves it once, and is told, part by part, what was made and what could not be made. Undo moves the project to the trash.`,
        input: input({
            name: { type: 'string', minLength: 1, maxLength: projects.NAME_MAX, description: `The project's name, at least ${projects.NAME_MIN} characters` },
            description: { type: 'string', maxLength: projects.DESCRIPTION_MAX, description: 'What the project is for, in a few lines' },
            statuses: NAMES(plans.STATUSES_MAX, plans.STATUS_NAME_MAX, 'Statuses to add, by name'),
            lists: NAMES(plans.LISTS_MAX, LIST_NAME_MAX, 'Lists to create, by name'),
            fields: { type: 'array', minItems: 1, maxItems: setup.FIELDS_MAX, items: FIELD },
            views: { type: 'array', minItems: 1, maxItems: plans.VIEWS_MAX, items: NEW_PROJECT_VIEW },
            ...REASON,
        }, ['name']),
        check: (args) => projects.problemIn(args),
        prepare: projectToFile,
        params: (args) => projects.draftOf(args),
    },
    {
        name: copies.ACTION,
        action: copies.ACTION,
        visibility: 'filtered',
        strict: true,
        filedUnder: GRANT,
        target: (args) => ({ ...WRITE_TARGET, ...projectTarget(args) }),
        description: 'Ask for a copy of a project the person can open, in a single call: the project and the name of the copy. '
            + 'The copy takes the project\'s folders, lists, statuses, custom fields, saved views and settings. Its automations come too, switched off, where the approver may manage automations. '
            + 'It takes no task unless tasks is true: set that only when the person asked, in words, for the tasks to be copied too. Copied tasks come without their assignees, and dates are kept only when dates is true. '
            + `A project with more than ${copies.TASKS_MAX} tasks is not copied with its tasks here: ask for the copy without them, or the person duplicates it in AlianHub. `
            + 'The copy is private, with only the person who approves it on it, whoever is on the project it is copied from; they add the others afterwards. '
            + 'Read projects.list first, for the project. A personal list cannot be copied, and a token kept to some projects cannot use it. '
            + `${WAITS} The person sees the copy as one preview, with how many tasks it would take, and approves it once. Undo moves the copy to the trash, unless a task or a doc was added to it since.`,
        input: input({
            projectId: { ...ID, description: 'The project to copy' },
            name: { type: 'string', minLength: 1, maxLength: projects.NAME_MAX, description: `The name of the copy, at least ${projects.NAME_MIN} characters` },
            tasks: { type: 'boolean', description: 'Copy the tasks too. Left out, only the setup is copied' },
            dates: { type: 'boolean', description: 'Keep the dates of the project, its lists and its tasks. Left out, the copy has none' },
            ...REASON,
        }, ['projectId', 'name']),
        check: (args) => copies.problemIn(copyAsked(args)),
        prepare: copyToFile,
        params: copyAsked,
    },
    {
        name: lists.FOLDER,
        action: lists.FOLDER,
        visibility: 'filtered',
        strict: true,
        filedUnder: GRANT,
        target: projectTarget,
        description: 'Ask for a new folder in a project, in a single call: its name and, when wanted, lists to create inside it, lists the project already has to move into it, '
            + `and up to ${lists.SUBFOLDERS_MAX} subfolders, each with its own lists. To put the new folder inside a folder that exists, name that folder in parentFolderId. `
            + 'Folders nest one level: a subfolder holds lists, not folders. Read lists.list first, for the folders and lists the project has. It cannot rename, move or delete a folder. '
            + `${WAITS} The person sees the folder and everything in it as one preview and approves it once; the answer then says, part by part, what was made or moved and what could not be. `
            + 'Undo puts the moved lists back and takes the folder away, unless someone has put a list in it since.',
        input: input({
            projectId: ID,
            name: FOLDER_NAME,
            parentFolderId: { ...ID, description: 'A top-level folder of this project to make the new folder a subfolder of' },
            ...FOLDER_PARTS,
            subfolders: {
                type: 'array', minItems: 1, maxItems: lists.SUBFOLDERS_MAX, items: input({ name: FOLDER_NAME, ...FOLDER_PARTS }, ['name']),
                description: 'Subfolders to make inside the new folder; not together with parentFolderId',
            },
            ...REASON,
        }, ['projectId', 'name']),
        check: (args) => lists.folderPlanProblem(args),
        prepare: folderToFile,
        params: (args) => ({ projectId: str(args.projectId, 40), ...lists.draftOf(args) }),
    },
    {
        name: lists.SPRINT,
        action: lists.SPRINT,
        visibility: 'filtered',
        strict: true,
        filedUnder: GRANT,
        target: (args) => ({ projectId: str(args.projectId, 40), sprintId: str(args.sprintId, 40) }),
        description: 'Make a list a sprint with a first day and a last day, or change the days of a list that is already a sprint. '
            + 'When there is no list yet, create it with list.create first, then name it here; the days are read where the person is. '
            + 'It cannot start or complete a sprint, and it cannot change a completed one: the person does those in AlianHub. '
            + `${WAITS} Undo makes it what it was: a plain list, or a sprint with its former days.`,
        input: input({
            projectId: ID,
            sprintId: ID,
            startDate: { ...DAY, description: 'The first day, as YYYY-MM-DD' },
            endDate: { ...DAY, description: 'The last day, as YYYY-MM-DD' },
            ...REASON,
        }, ['projectId', 'sprintId', 'startDate', 'endDate']),
        check: (args) => lists.sprintProblem(args),
        params: (args) => ({ projectId: str(args.projectId, 40), sprintId: str(args.sprintId, 40), startDate: str(args.startDate, 10), endDate: str(args.endDate, 10) }),
    },
];

module.exports = { TOOLS, LOOK };

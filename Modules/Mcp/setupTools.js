const setup = require('../Agents/setupRequests');
const { GRANT } = require('./manageFlag');
const { loadProject } = require('./dataTools');

// Setting a project up: custom fields and saved views. Both show to everyone on the project, so a call never makes
// one: it is filed for the person to approve in AlianHub (their actions are proposeOnly, Agents/registry/setup.js),
// and what is approved runs the web app's own routes as that person (Modules/Agents/setupRequests.js).

const RAW_OPTIONS_MAX = 100;
const RAW_TEXT_MAX = 200;

const str = (v, max = 500) => String(v === undefined || v === null ? '' : v).slice(0, max);
const ID = Object.freeze({ type: 'string', pattern: '^[a-fA-F0-9]{24}$' });
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

const LOOK = Object.freeze({
    groupBy: { type: 'string', maxLength: 24, description: `One of ${Object.keys(setup.GROUPS).join(', ')}, or the id of a custom field (see fields.list)` },
    sortBy: { type: 'string', maxLength: 24, description: `One of ${Object.keys(setup.SORTS).join(', ')}, or the id of a custom field` },
    sortDirection: { type: 'string', enum: [...setup.DIRECTIONS] },
    mine: { type: 'boolean', description: 'Show each person only their own tasks' },
    assigneeIds: { type: 'array', maxItems: setup.LOOK_MAX.assignees, items: ID, description: 'Only tasks of these members' },
    statuses: { type: 'array', maxItems: setup.LOOK_MAX.statuses, items: { type: 'string', minLength: 1, maxLength: setup.LOOK_MAX.status }, description: 'Only tasks in these statuses, by name (see statuses.list)' },
    priorities: { type: 'array', maxItems: setup.PRIORITIES.length, items: { type: 'string', enum: [...setup.PRIORITIES] } },
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
            + `${WAITS} Set a value on a task afterwards with task.field.set.`,
        input: input({ projectId: ID, fields: { type: 'array', minItems: 1, maxItems: setup.FIELDS_MAX, items: FIELD }, ...REASON }, ['projectId', 'fields']),
        check: (args) => setup.draftsProblem(args.fields),
        params: (args) => ({ projectId: str(args.projectId, 40), definitions: setup.draftsOf(args.fields) }),
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
];

module.exports = { TOOLS };

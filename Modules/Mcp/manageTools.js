const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { ACTIVE_SEAT } = require('../../Config/seatStatus');
const { ROLE_GUEST, ROLE_OWNER, ROLE_ADMIN, ROLE_MEMBER } = require('../../Config/roleTypes');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../utils/mongo-handler/objectIdKeys');
const registry = require('../Agents/registry');
const { oid } = require('../Automations/engine/tools');
const { fieldTaskTypes } = require('../CustomField/helpers/fieldTaskTypes');
const { optionsOf, optionLabel, isTaskFieldOf } = require('../CustomField/helpers/fieldValueInput');
const { TASK_ACCESS_FIELDS } = require('./visibility');
const { GRANT } = require('./manageFlag');
const { listOf, loadProject, NO_PROJECT, NO_TASK } = require('./dataTools');
const { planRow } = require('./taskRows');
const { PRIORITIES, ASSIGN_MODES, TITLE_MAX, DESCRIPTION_MAX, ESTIMATE_MAX_MINUTES, ASSIGNEES_MAX } = require('../Agents/taskRequests');
const v2 = require('./v2Flag');
const cursor = require('./cursor');
const names = require('./names');

// What an outside agent needs to manage work rather than only report on it. Each write names its
// target so tools.call checks it against the caller's filter first, then runs as a registry action
// whose executor is the task route's own handler (Modules/Agents/taskRequests.js).

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const FIELDS_MAX = 200;
const ROLE_NAMES = Object.freeze({ [ROLE_GUEST]: 'guest', [ROLE_OWNER]: 'owner', [ROLE_ADMIN]: 'admin', [ROLE_MEMBER]: 'member' });

const isId = (v) => OBJECT_ID.test(String(v || ''));
const str = (v, max = 500) => String(v === undefined || v === null ? '' : v).slice(0, max);
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const find = (database, type, filter, fields, options) => MongoDbCrudOpration(database, { type, data: [filter, fields || null, options] }, 'find');

const ID = Object.freeze({ type: 'string', pattern: '^[a-fA-F0-9]{24}$' });
const REASON = Object.freeze({ reason: { type: 'string', maxLength: 500, description: 'Why, in a line; it is kept in the audit log' } });
const taskTarget = (args) => ({ taskId: str(args.taskId, 40) });
const input = (properties, required) => ({ type: 'object', additionalProperties: false, properties, required });

const EDITED = Object.freeze({ title: 'TaskName', description: 'rawDescription', priority: 'Task_Priority', dueDate: 'DueDate', startDate: 'startDate', estimateMinutes: 'totalEstimatedTime' });
const editedFields = (args) => Object.fromEntries(Object.entries(EDITED).filter(([arg]) => args[arg] !== undefined).map(([arg, field]) => [field, args[arg]]));

const fieldRow = (definition) => ({
    fieldId: String(definition._id),
    title: definition.fieldTitle || '',
    type: definition.fieldType || '',
    options: optionsOf(definition).map((option) => ({ id: String(option.id), label: optionLabel(option) })),
    taskTypeKeys: fieldTaskTypes(definition),
});

const personName = (user) => user.Employee_Name || [user.Employee_FName, user.Employee_LName].filter(Boolean).join(' ') || '';

const SEARCH_INPUT = Object.freeze({
    assigneeId: { type: 'string', description: 'Only tasks assigned to this member' },
    sprintId: { type: 'string', description: 'Only tasks in this list' },
    dueFrom: { type: 'string', description: 'Due on or after this day, YYYY-MM-DD (UTC)' },
    dueTo: { type: 'string', description: 'Due on or before this day, YYYY-MM-DD (UTC)' },
});

const dayStart = (day) => (DAY.test(String(day)) && Number.isFinite(Date.parse(`${day}T00:00:00Z`)) ? Date.parse(`${day}T00:00:00Z`) : null);

/* The find clause the planning filters of tasks.search add, or the reason one of them is not usable. */
const searchFilter = (args) => {
    const filter = {};
    if (args.assigneeId !== undefined && args.assigneeId !== '') {
        if (!isId(args.assigneeId)) return { error: 'assigneeId must be a member id' };
        filter.AssigneeUserId = String(args.assigneeId);
    }
    if (args.sprintId !== undefined && args.sprintId !== '') {
        if (!isId(args.sprintId)) return { error: 'sprintId must be a list id' };
        filter.sprintId = { $in: idForms(String(args.sprintId)) };
    }
    const from = args.dueFrom ? dayStart(args.dueFrom) : undefined;
    const to = args.dueTo ? dayStart(args.dueTo) : undefined;
    if (from === null || to === null) return { error: 'dueFrom and dueTo must be YYYY-MM-DD' };
    if (from !== undefined || to !== undefined) {
        filter.DueDate = { ...(from !== undefined ? { $gte: new Date(from) } : {}), ...(to !== undefined ? { $lte: new Date(to + DAY_MS - 1) } : {}) };
    }
    return { filter };
};

const TOOLS = [
    {
        name: 'fields.list',
        action: 'fields.list',
        description: 'The custom fields tasks in one project carry: id, title, type, the options of a dropdown and the task types the field is for (none means every type). Set one with task.field.set.',
        input: input({ projectId: ID }, ['projectId']),
        visibility: 'filtered',
        strict: true,
        readParams: (args) => ({ projectId: str(args.projectId, 40) }),
        run: async (ctx, args, vis) => {
            const project = await loadProject(ctx, vis, args.projectId);
            if (!project) return { ...NO_PROJECT };
            const projectId = String(project._id);
            const rows = await find(ctx.companyId, SCHEMA_TYPE.CUSTOM_FIELDS, { type: 'task', isDelete: { $ne: false } }, null, { sort: { fieldTitle: 1, _id: 1 } });
            return { projectId, fields: (rows || []).filter((definition) => isTaskFieldOf(definition, projectId)).slice(0, FIELDS_MAX).map(fieldRow) };
        },
    },
    {
        name: 'subtasks.list',
        action: 'subtasks.list',
        description: 'The direct subtasks of a task you can open, oldest first, each with its own subtask count and the chain of tasks above it.',
        input: input({ taskId: ID, limit: { type: 'integer', minimum: 1, maximum: cursor.PAGE_MAX } }, ['taskId']),
        visibility: 'filtered',
        strict: true,
        paginated: true,
        run: async (ctx, args, vis) => {
            const parent = await MongoDbCrudOpration(ctx.companyId, {
                type: SCHEMA_TYPE.TASKS, data: [{ _id: oid(String(args.taskId)), deletedStatusKey: { $ne: 1 } }, TASK_ACCESS_FIELDS],
            }, 'findOne');
            if (!vis.allowsTask(parent)) return { ...NO_TASK };
            const filter = { CompanyId: String(ctx.companyId), deletedStatusKey: { $ne: 1 }, ParentTaskId: { $in: idForms(String(parent._id)) }, ...vis.taskClause() };
            const out = await listOf(ctx, 'subtasks.list', args, 'subtasks', { type: SCHEMA_TYPE.TASKS, filter, sort: { createdAt: 1, _id: 1 } }, planRow,
                (rows) => names.forTasks(ctx, rows, planRow));
            return { parentTaskId: String(parent._id), ...out };
        },
    },
    {
        name: 'members.list',
        action: 'members.list',
        description: 'Active members of the workspace by name: id, name and role. With a projectId each row also says whether that person can open the project, which task.assign requires.',
        input: input({ query: { type: 'string', maxLength: 120, description: 'Part of the name' }, projectId: ID, limit: { type: 'integer', minimum: 1, maximum: cursor.PAGE_MAX } }, []),
        visibility: 'filtered',
        strict: true,
        paginated: true,
        readParams: (args) => (isId(args.projectId) ? { projectId: String(args.projectId) } : {}),
        run: async (ctx, args, vis) => {
            const project = args.projectId === undefined ? null : await loadProject(ctx, vis, args.projectId);
            if (args.projectId !== undefined && !project) return { ...NO_PROJECT };
            const seats = (await find(ctx.companyId, SCHEMA_TYPE.COMPANY_USERS, { ...ACTIVE_SEAT }, { userId: 1, roleType: 1 })) || [];
            const roleOf = new Map(seats.filter((seat) => isId(seat.userId)).map((seat) => [String(seat.userId), seat.roleType]));
            const users = roleOf.size
                ? (await find(dbCollections.GLOBAL, SCHEMA_TYPE.USERS, { _id: { $in: [...roleOf.keys()].map(oid) } }, { Employee_Name: 1, Employee_FName: 1, Employee_LName: 1 })) || []
                : [];
            const wanted = args.query ? new RegExp(escapeRegex(str(args.query, 120)), 'i') : null;
            const everyone = users
                .map((user) => ({ userId: String(user._id), name: personName(user), roleType: roleOf.get(String(user._id)), role: ROLE_NAMES[roleOf.get(String(user._id))] || 'custom' }))
                .filter((member) => !wanted || wanted.test(member.name))
                .sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
            const slice = ({ skip, limit }) => everyone.slice(skip, skip + limit);
            const { rows, nextCursor } = v2.enabled()
                ? await cursor.page(ctx, 'members.list', args, slice)
                : { rows: slice({ skip: 0, limit: cursor.pageSize(args.limit) }) };
            if (!project) return nextCursor ? { members: rows, nextCursor } : { members: rows };
            const { canReadProject } = require('../../Config/projectAccess');
            const members = [];
            for (const member of rows) {
                members.push({ ...member, opensProject: (await canReadProject(ctx.companyId, member.userId, String(project._id))).allowed === true });
            }
            return nextCursor ? { projectId: String(project._id), members, nextCursor } : { projectId: String(project._id), members };
        },
    },
    {
        name: 'task.update',
        action: 'task.edit',
        visibility: 'filtered',
        grant: GRANT,
        strict: true,
        target: taskTarget,
        description: 'Change a task\'s title, description, priority, due date, start date or estimate. One call may set several; a field you leave out is not touched.',
        input: input({
            taskId: ID,
            title: { type: 'string', minLength: 1, maxLength: TITLE_MAX },
            description: { type: 'string', maxLength: DESCRIPTION_MAX, description: 'Plain text; it replaces the description' },
            priority: { type: 'string', enum: [...PRIORITIES] },
            dueDate: { type: ['string', 'null'], maxLength: 40, description: 'YYYY-MM-DD or an ISO date and time; null clears it' },
            startDate: { type: 'string', maxLength: 40, description: 'YYYY-MM-DD or an ISO date and time' },
            estimateMinutes: { type: 'integer', minimum: 0, maximum: ESTIMATE_MAX_MINUTES },
            ...REASON,
        }, ['taskId']),
        check: (args) => (Object.keys(editedFields(args)).length ? '' : `name at least one of ${Object.keys(EDITED).join(', ')}`),
        params: (args) => ({ taskId: str(args.taskId, 40), fields: editedFields(args), note: str(args.reason, 500) }),
    },
    {
        name: 'task.assign',
        action: 'task.assignees.set',
        visibility: 'filtered',
        grant: GRANT,
        strict: true,
        target: taskTarget,
        description: 'Set, add or remove a task\'s assignees. Each person added must be an active member who can open the task\'s project; find ids with members.list.',
        input: input({
            taskId: ID,
            mode: { type: 'string', enum: [...ASSIGN_MODES], description: 'set replaces the list (an empty list unassigns everyone); add and remove change it' },
            userIds: { type: 'array', items: ID, maxItems: ASSIGNEES_MAX },
            ...REASON,
        }, ['taskId', 'mode', 'userIds']),
        params: (args) => ({ taskId: str(args.taskId, 40), mode: str(args.mode, 10), userIds: args.userIds.map((id) => str(id, 40)) }),
    },
    {
        name: 'task.field.set',
        action: 'task.field.set',
        visibility: 'filtered',
        grant: GRANT,
        strict: true,
        target: taskTarget,
        description: 'Set one custom field on a task. The value is in the field\'s own type (see fields.list): text, a number, true or false, a day, an option id or label, a list of member ids; null clears it.',
        input: input({ taskId: ID, fieldId: ID, value: { description: 'The value in the field\'s type; null clears it' }, ...REASON }, ['taskId', 'fieldId', 'value']),
        params: (args) => ({ taskId: str(args.taskId, 40), fieldId: str(args.fieldId, 40), value: args.value }),
    },
    {
        name: 'task.move',
        action: 'task.move',
        visibility: 'filtered',
        grant: GRANT,
        strict: true,
        target: (args) => ({ taskId: str(args.taskId, 40), projectId: str(args.projectId, 40), sprintId: str(args.sprintId, 40) }),
        description: 'Move a top-level task, with its subtasks, to another list: in its own project or in another project you can move tasks into. In another project it takes the status and task type of the same name there, and keeps the assignees who can open that project. A subtask moves with its parent.',
        input: input({ taskId: ID, projectId: { ...ID, description: 'The project of the list to move to' }, sprintId: { ...ID, description: 'The list to move to (see sprints.list)' }, ...REASON }, ['taskId', 'projectId', 'sprintId']),
        params: (args) => ({ taskId: str(args.taskId, 40), projectId: str(args.projectId, 40), sprintId: str(args.sprintId, 40) }),
    },
    {
        name: 'task.archive',
        action: 'task.archive',
        visibility: 'filtered',
        grant: GRANT,
        strict: true,
        target: taskTarget,
        description: 'Archive a task; its subtasks are archived with it. Nothing is deleted, and task.restore brings it back.',
        input: input({ taskId: ID, ...REASON }, ['taskId']),
        params: (args) => ({ taskId: str(args.taskId, 40) }),
    },
    {
        name: 'task.restore',
        action: 'task.restore',
        visibility: 'filtered',
        grant: GRANT,
        strict: true,
        target: taskTarget,
        description: 'Restore an archived task, with the subtasks archived along with it.',
        input: input({ taskId: ID, ...REASON }, ['taskId']),
        params: (args) => ({ taskId: str(args.taskId, 40) }),
    },
];

const SCOPES = Object.freeze({
    'fields.list': 'projects:read',
    'subtasks.list': 'tasks:read',
    'members.list': 'projects:read',
    'task.update': 'tasks:write',
    'task.assign': 'tasks:write',
    'task.field.set': 'tasks:write',
    'task.move': 'tasks:write',
    'task.archive': 'tasks:write',
    'task.restore': 'tasks:write',
});

const offered = () => TOOLS.filter((t) => registry.has(t.action));

const grantOfAction = (action) => { const tool = TOOLS.find((t) => t.action === String(action)); return tool && tool.grant ? tool.grant : null; };

module.exports = { TOOLS, SCOPES, SEARCH_INPUT, offered, searchFilter, grantOfAction };

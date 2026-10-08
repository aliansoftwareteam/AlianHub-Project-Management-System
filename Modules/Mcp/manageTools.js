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
const manageFlag = require('./manageFlag');
const { listOf, loadProject, NO_PROJECT, NO_TASK } = require('./dataTools');
const { planRow } = require('./taskRows');
const { REPLY_TO, REPLY_INPUT, replyParams } = require('./commentReply');
const { PRIORITIES, ASSIGN_MODES, TITLE_MAX, DESCRIPTION_MAX, ESTIMATE_MAX_MINUTES, ASSIGNEES_MAX, LINK_KINDS, LINKS_MAX } = require('../Agents/taskRequests');
const pageRequests = require('../Agents/pageRequests');
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

const { GRANT, DOCS_GRANT } = manageFlag;
const HISTORY_TEXT_MAX = 600;
/* A batch that names more than one task waits for a person as one proposal and takes BATCH_MAX. Any other batch is
 * applied change by change with no approval of the whole, so it keeps the smaller size. */
const BATCH_MAX = 50;
const BATCH_AT_ONCE_MAX = 25;
const batchTooLarge = (args) => {
    const given = args && Array.isArray(args.operations) ? args.operations.length : 0;
    return given > BATCH_MAX
        ? `a batch takes at most ${BATCH_MAX} changes, and this one has ${given}. Nothing was filed and nothing has changed. Send the first ${BATCH_MAX} as one batch and the rest as another, and tell the person each one waits for its own approval.`
        : '';
};
const batchNotWaiting = (given) => `a batch takes more than ${BATCH_AT_ONCE_MAX} changes only when it names more than one task, because it then waits for a person's approval as one proposal. `
    + `This one has ${given} and names one task or none, so its changes would not wait together. Nothing was run and nothing has changed. Send at most ${BATCH_AT_ONCE_MAX} of them in a call.`;

const isId = (v) => OBJECT_ID.test(String(v || ''));
const idOf = (v) => (v === undefined || v === null ? '' : String(v));
const str = (v, max = 500) => String(v === undefined || v === null ? '' : v).slice(0, max);
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const find = (database, type, filter, fields, options) => MongoDbCrudOpration(database, { type, data: [filter, fields || null, options] }, 'find');

const ID = Object.freeze({ type: 'string', pattern: '^[a-fA-F0-9]{24}$' });
const REASON = Object.freeze({ reason: { type: 'string', maxLength: 500, description: 'Why, in one line. It is kept in the record of changes.' } });
const taskTarget = (args) => ({ taskId: str(args.taskId, 40) });
const input = (properties, required) => ({ type: 'object', additionalProperties: false, properties, required });

const EDITED = Object.freeze({ title: 'TaskName', description: 'rawDescription', priority: 'Task_Priority', dueDate: 'DueDate', startDate: 'startDate', estimateMinutes: 'totalEstimatedTime' });
const editedFields = (args) => Object.fromEntries(Object.entries(EDITED).filter(([arg]) => args[arg] !== undefined).map(([arg, field]) => [field, args[arg]]));

const CREATED = Object.freeze({ description: 'rawDescription', assigneeIds: 'AssigneeUserId', priority: 'Task_Priority', dueDate: 'DueDate', startDate: 'startDate', status: 'status', taskType: 'TaskType', estimateMinutes: 'totalEstimatedTime', links: 'links' });
const createdFields = (args) => Object.fromEntries(Object.entries(CREATED).filter(([arg]) => args[arg] !== undefined).map(([arg, field]) => [field, args[arg]]));

const CREATE_OPTIONS = Object.freeze({
    description: { type: 'string', maxLength: DESCRIPTION_MAX, description: 'Plain text' },
    assigneeIds: { type: 'array', items: ID, maxItems: ASSIGNEES_MAX, description: 'Active members who can open the project (see members.list)' },
    priority: { type: 'string', enum: [...PRIORITIES] },
    dueDate: { type: 'string', maxLength: 40, description: 'YYYY-MM-DD, or a date and time' },
    startDate: { type: 'string', maxLength: 40, description: 'YYYY-MM-DD, or a date and time' },
    status: { type: 'string', minLength: 1, maxLength: 60, description: 'A status of the project, by name (see statuses.list); the opening status when left out' },
    taskType: { type: 'string', minLength: 1, maxLength: 60, description: 'A task type of the project, by name' },
    estimateMinutes: { type: 'integer', minimum: 0, maximum: ESTIMATE_MAX_MINUTES },
    links: {
        type: 'array', maxItems: LINKS_MAX,
        items: { type: 'object', additionalProperties: false, properties: { url: { type: 'string', maxLength: 2000 }, label: { type: 'string', maxLength: 200 }, kind: { type: 'string', enum: [...LINK_KINDS] } }, required: ['url'] },
    },
});

const MENTIONS = 'To mention a member so they are notified, write @[Their Name](their member id); @[All](everyone) reaches everyone who can open the task.';

/* The activity log stores each entry as a line of markup with dates as DATE_<milliseconds>. */
const plainEntry = (message) => String(message || '')
    .replace(/<[^>]+>/g, '')
    .replace(/DATE_(\d{10,14})/g, (whole, millis) => new Date(Number(millis)).toISOString())
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim().slice(0, HISTORY_TEXT_MAX);

const historyRow = (entry) => ({ entryId: String(entry._id), kind: entry.Key || '', text: plainEntry(entry.Message), userId: idOf(entry.UserId), at: entry.createdAt || null });

const linkRow = (link) => ({
    linkId: idOf(link._id), url: link.url || String(link), label: link.label || '', kind: link.kind || 'link',
    addedBy: idOf(link.addedBy), ...(link.actorType ? { actorType: link.actorType } : {}), addedAt: link.addedAt || null,
});

const visibleTask = async (ctx, vis, taskId, fields = TASK_ACCESS_FIELDS) => {
    const task = isId(taskId)
        ? await MongoDbCrudOpration(ctx.companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: oid(String(taskId)), deletedStatusKey: { $ne: 1 } }, fields] }, 'findOne')
        : null;
    return vis.allowsTask(task) ? task : null;
};

/* What task.get adds for a caller that manages tasks: where the task sits, who holds it, and each link's id. */
const planBrief = async (ctx, brief) => {
    const task = await MongoDbCrudOpration(ctx.companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: oid(brief.taskId) }] }, 'findOne');
    if (!task) return brief;
    const row = planRow(task);
    return {
        ...brief,
        assigneeIds: row.assigneeIds, startDate: row.startDate, estimateMinutes: row.estimateMinutes,
        subTasks: row.subTasks, parentTaskId: row.parentTaskId, ancestors: row.ancestors, archived: row.archived,
        links: (task.links || []).map(linkRow),
        youMayNot: ['Merge, deploy to production, or delete anything'],
    };
};

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
        if (!isId(args.assigneeId)) return { error: 'assigneeId must be the id of a member (see members.list).' };
        filter.AssigneeUserId = String(args.assigneeId);
    }
    if (args.sprintId !== undefined && args.sprintId !== '') {
        if (!isId(args.sprintId)) return { error: 'sprintId must be the id of a list (see sprints.list).' };
        filter.sprintId = { $in: idForms(String(args.sprintId)) };
    }
    const from = args.dueFrom ? dayStart(args.dueFrom) : undefined;
    const to = args.dueTo ? dayStart(args.dueTo) : undefined;
    if (from === null || to === null) return { error: 'dueFrom and dueTo must be written YYYY-MM-DD.' };
    if (from !== undefined || to !== undefined) {
        filter.DueDate = { ...(from !== undefined ? { $gte: new Date(from) } : {}), ...(to !== undefined ? { $lte: new Date(to + DAY_MS - 1) } : {}) };
    }
    return { filter };
};

const TOOLS = [
    {
        name: 'fields.list',
        action: 'fields.list',
        description: 'Shows the custom fields the tasks in one project carry: id, title, type, the options of a dropdown and the task types the field is for (none means every type). Set one with task.field.set. Changes nothing.',
        input: input({ projectId: ID }, ['projectId']),
        visibility: 'filtered',
        grant: GRANT,
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
        description: 'Shows the direct subtasks of a task the person can open, oldest first, each with its own subtask count and the chain of tasks above it. Changes nothing.',
        input: input({ taskId: ID, limit: { type: 'integer', minimum: 1, maximum: cursor.PAGE_MAX } }, ['taskId']),
        visibility: 'filtered',
        grant: GRANT,
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
        description: 'Lists the active members of the workspace by name: id, name and role. With a projectId each row also says whether that person can open the project, which task.assign needs. Changes nothing.',
        input: input({ query: { type: 'string', maxLength: 120, description: 'Part of the name' }, projectId: ID, limit: { type: 'integer', minimum: 1, maximum: cursor.PAGE_MAX } }, []),
        visibility: 'filtered',
        grant: GRANT,
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
        name: 'task.history',
        action: 'task.history',
        description: 'Shows the activity log of a task the person can open, newest first: who changed what, and when, as the task panel shows it. Changes nothing.',
        input: input({ taskId: ID, limit: { type: 'integer', minimum: 1, maximum: cursor.PAGE_MAX } }, ['taskId']),
        visibility: 'filtered',
        grant: GRANT,
        strict: true,
        paginated: true,
        run: async (ctx, args, vis) => {
            const task = await visibleTask(ctx, vis, args.taskId);
            if (!task) return { ...NO_TASK };
            const filter = { Type: { $ne: 'project' }, ProjectId: { $in: idForms(idOf(task.ProjectID)) }, TaskId: String(task._id) };
            const out = await listOf(ctx, 'task.history', args, 'entries', { type: SCHEMA_TYPE.HISTORY, filter, sort: { createdAt: -1, _id: -1 } }, historyRow, async (rows) => {
                const named = await names.resolver(ctx, { projectIds: [idOf(task.ProjectID)], userIds: rows.map((entry) => entry.UserId).filter(isId) });
                return rows.map((entry) => ({ ...historyRow(entry), person: isId(entry.UserId) ? named.person(String(entry.UserId), idOf(task.ProjectID)) : null }));
            });
            return { taskId: String(task._id), ...out };
        },
    },
    {
        name: 'task.links.list',
        action: 'task.links.list',
        description: 'Shows the pull requests, branches, docs and other links attached to a task the person can open. Changes nothing.',
        input: input({ taskId: ID }, ['taskId']),
        visibility: 'filtered',
        grant: GRANT,
        strict: true,
        run: async (ctx, args, vis) => {
            const task = await visibleTask(ctx, vis, args.taskId, { ...TASK_ACCESS_FIELDS, links: 1 });
            if (!task) return { ...NO_TASK };
            return { taskId: String(task._id), links: (Array.isArray(task.links) ? task.links : []).map(linkRow) };
        },
    },
    {
        name: 'comment.update',
        action: 'comment.update',
        visibility: 'filtered',
        grant: GRANT,
        strict: true,
        target: taskTarget,
        description: 'Changes the text of a comment an agent wrote for the person on a task, at once. You cannot change a comment a person wrote, or one on another task.',
        input: input({ taskId: ID, commentId: ID, text: { type: 'string', minLength: 1, maxLength: 20000 }, ...REASON }, ['taskId', 'commentId', 'text']),
        params: (args) => ({ taskId: str(args.taskId, 40), commentId: str(args.commentId, 40), body: str(args.text, 20000) }),
    },
    {
        name: 'tasks.batch',
        action: 'tasks.batch',
        visibility: 'filtered',
        grant: GRANT,
        strict: true,
        batch: true,
        target: () => ({}),
        description: `Runs several change tools in one call, in order: up to ${BATCH_AT_ONCE_MAX} when every step is on the same task, and up to ${BATCH_MAX} when the steps name more than one task. When every step is on the same task, each is applied on its own and reports its own result, so one refusal does not stop or undo the others, and a person can undo the ones that applied together. When the steps name more than one task, nothing runs yet: the changes wait in AlianHub as one proposal that a person approves or declines whole. A link counts both of its tasks, and each new task, subtask or doc counts as a task of its own. Keep such a batch inside one project. `
            + 'When one request changes many tasks, or changes several things on each of them, put every change in one batch, so the person approves once: do not split it into smaller batches. '
            + 'Name each step\'s tool by its AlianHub name with dots, such as task.update; the name your tool list shows, such as task_update, is taken too.',
        tooLarge: batchTooLarge,
        input: input({
            operations: {
                type: 'array', minItems: 1, maxItems: BATCH_MAX,
                items: { type: 'object', additionalProperties: false, properties: { tool: { type: 'string', minLength: 1, maxLength: 60 }, arguments: { type: 'object' } }, required: ['tool', 'arguments'] },
            },
            ...REASON,
        }, ['operations']),
        params: () => ({}),
    },
    {
        name: 'page.create',
        action: 'page.create',
        visibility: 'filtered',
        creates: true,
        grant: DOCS_GRANT,
        strict: true,
        target: (args) => ({
            ...(args.projectId !== undefined ? { projectId: str(args.projectId, 40) } : { companyWide: true }),
            ...(args.parentPageId !== undefined ? { pageId: str(args.parentPageId, 40) } : {}),
            ...(args.taskId !== undefined ? { taskId: str(args.taskId, 40) } : {}),
        }),
        description: 'Creates a doc in a project, or one for the whole workspace when no project is named. The text is plain text or simple Markdown (headings, lists, paragraphs). It stays a draft marked as an agent\'s until a person approves it.',
        input: input({
            title: { type: 'string', minLength: 1, maxLength: pageRequests.TITLE_MAX },
            text: { type: 'string', maxLength: pageRequests.TEXT_MAX },
            projectId: ID,
            parentPageId: { ...ID, description: 'Make it a sub-page of this doc' },
            taskId: { ...ID, description: 'Link the doc to this task' },
            ...REASON,
        }, ['title']),
        params: (args) => ({
            title: str(args.title, pageRequests.TITLE_MAX),
            ...(args.text !== undefined ? { text: args.text } : {}),
            ...(args.projectId !== undefined ? { projectId: str(args.projectId, 40) } : {}),
            ...(args.parentPageId !== undefined ? { parentPageId: str(args.parentPageId, 40) } : {}),
            ...(args.taskId !== undefined ? { taskId: str(args.taskId, 40) } : {}),
        }),
    },
    {
        name: 'page.update',
        action: 'page.update',
        visibility: 'filtered',
        grant: DOCS_GRANT,
        strict: true,
        target: (args) => ({ pageId: str(args.pageId, 40) }),
        description: 'Changes a doc\'s title, its text, or both, at once. The text replaces the body and is plain text or simple Markdown. The old version is kept in the doc\'s version history.',
        input: input({ pageId: ID, title: { type: 'string', minLength: 1, maxLength: pageRequests.TITLE_MAX }, text: { type: 'string', maxLength: pageRequests.TEXT_MAX }, ...REASON }, ['pageId']),
        check: (args) => (args.title === undefined && args.text === undefined ? 'name a title or a text to change' : ''),
        params: (args) => ({ pageId: str(args.pageId, 40), ...(args.title !== undefined ? { title: args.title } : {}), ...(args.text !== undefined ? { text: args.text } : {}) }),
    },
    {
        name: 'task.update',
        action: 'task.edit',
        visibility: 'filtered',
        grant: GRANT,
        strict: true,
        target: taskTarget,
        description: 'Changes a task\'s title, description, priority, due date, start date or estimate at once, and the person can undo it. One call may change several; a detail you leave out is not touched. '
            + 'When a new due date ends the task later and other tasks wait on it (it blocks them), they move later by the same working days, as the Gantt moves them, in this one change and one undo: '
            + 'waitingTasks.moved lists them, and waitingTasks.startTooEarly lists any the person may not reschedule, which now start before this task ends. Do not move the moved ones again.',
        input: input({
            taskId: ID,
            title: { type: 'string', minLength: 1, maxLength: TITLE_MAX },
            description: { type: 'string', maxLength: DESCRIPTION_MAX, description: 'Plain text; it replaces the description' },
            priority: { type: 'string', enum: [...PRIORITIES] },
            dueDate: { type: ['string', 'null'], maxLength: 40, description: 'YYYY-MM-DD, or a date and time; null clears it' },
            startDate: { type: 'string', maxLength: 40, description: 'YYYY-MM-DD, or a date and time' },
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
        description: 'Sets, adds or removes a task\'s assignees at once. Each person added must be an active member who can open the task\'s project; find ids with members.list.',
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
        description: 'Sets one custom field on a task at once. The value is in the field\'s own type (see fields.list): text, a number, true or false, a day, an option id or label, or a list of member ids; null clears it.',
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
        description: 'Moves a top-level task, with its subtasks, to another list: in its own project, or in another project the person can move tasks into. In another project it takes the status and task type of the same name there, and keeps the assignees who can open that project. A subtask moves with its parent. A move cannot be undone, so it waits for a person\'s approval.',
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
        description: 'Archives a task, and its subtasks with it. Nothing is deleted, and task.restore brings it back. A task with no subtasks is archived at once. A task that has subtasks waits for a person\'s approval.',
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
        description: 'Restores an archived task, with the subtasks archived along with it. A task with no subtasks comes back at once. A task whose subtasks come back with it waits for a person\'s approval.',
        input: input({ taskId: ID, ...REASON }, ['taskId']),
        params: (args) => ({ taskId: str(args.taskId, 40) }),
    },
];

/* The scope a manage tool needs is the grant of the same name. */
const SCOPES = Object.freeze(Object.fromEntries(TOOLS.map((tool) => [tool.name, tool.grant])));

/* What an existing tool becomes for a caller whose token was created to manage tasks. Everyone else keeps the tool as it is. */
const VARIANTS = Object.freeze({
    'task.status.set': {
        name: 'task.status.set',
        action: 'task.status.change',
        visibility: 'filtered',
        grant: GRANT,
        strict: true,
        target: taskTarget,
        description: 'Sets a task to any status its project uses (see statuses.list), a done or closed one included. A close is recorded as made for the person through this agent, and stays unchecked until a person checks it. A project may hold a close for a person\'s approval, or leave it to a person: the answer says which.',
        input: input({ taskId: ID, status: { type: 'string', minLength: 1, maxLength: 60 }, ...REASON }, ['taskId', 'status']),
        params: (args) => ({ taskId: str(args.taskId, 40), status: { name: str(args.status, 60) } }),
    },
    'task.create': {
        name: 'task.create',
        action: 'task.add',
        visibility: 'filtered',
        creates: true,
        grant: GRANT,
        strict: true,
        target: (args) => ({ projectId: str(args.projectId, 40), sprintId: str(args.sprintId, 40) }),
        description: 'Creates a task in a project at once, with as much as you know in one call: description, assignees, priority, dates, status, task type, estimate and links. Left out, it goes in the project\'s first list, in its opening status, unassigned.',
        input: input({ projectId: ID, title: { type: 'string', minLength: 1, maxLength: TITLE_MAX }, sprintId: { ...ID, description: 'The list to create it in' }, ...CREATE_OPTIONS, ...REASON }, ['projectId', 'title']),
        params: (args) => ({ projectId: str(args.projectId, 40), sprintId: str(args.sprintId, 40), title: str(args.title, TITLE_MAX), fields: createdFields(args) }),
    },
    'subtask.create': {
        name: 'subtask.create',
        action: 'subtask.add',
        visibility: 'filtered',
        creates: true,
        grant: GRANT,
        strict: true,
        target: taskTarget,
        description: 'Creates a subtask under a task at once, with as much as you know in one call: description, assignees, priority, dates, status, task type, estimate and links. Subtasks nest three levels deep at most.',
        input: input({ taskId: ID, title: { type: 'string', minLength: 1, maxLength: TITLE_MAX }, ...CREATE_OPTIONS, ...REASON }, ['taskId', 'title']),
        params: (args) => ({ taskId: str(args.taskId, 40), title: str(args.title, TITLE_MAX), fields: createdFields(args) }),
    },
    'task.comment': {
        name: 'task.comment',
        action: 'task.comment',
        visibility: 'filtered',
        grant: GRANT,
        strict: true,
        target: taskTarget,
        description: `Adds a comment to a task at once, and the person can undo it. Use it to report what you found, ask a question or share a link. ${MENTIONS} ${REPLY_TO}`,
        input: input({ taskId: ID, body: { type: 'string', minLength: 1, maxLength: 20000 }, ...REPLY_INPUT, ...REASON }, ['taskId', 'body']),
        params: (args) => ({ taskId: str(args.taskId, 40), body: str(args.body, 20000), notifyMentions: true, ...replyParams(args) }),
    },
    'comment.create': {
        name: 'comment.create',
        action: 'comment.create',
        visibility: 'filtered',
        grant: GRANT,
        strict: true,
        target: taskTarget,
        description: `Adds a comment to a task the person can open, at once, and the person can undo it. The text is saved as plain text. ${MENTIONS} ${REPLY_TO}`,
        input: input({ taskId: ID, text: { type: 'string', minLength: 1, maxLength: 20000 }, ...REPLY_INPUT, ...REASON }, ['taskId', 'text']),
        params: (args) => ({ taskId: str(args.taskId, 40), body: str(args.text, 20000), notifyMentions: true, ...replyParams(args) }),
    },
});

const variantOf = (name) => (manageFlag.enabled() && Object.hasOwn(VARIANTS, name) && registry.has(VARIANTS[name].action) ? VARIANTS[name] : null);

const offered = () => TOOLS.filter((t) => registry.has(t.action));

/* The grant an action needs: only the actions these tools alone reach, not the ones a variant shares with its plain
 * tool, and the actions of the work tools that name a grant. */
const grantOfAction = (action) => {
    const tool = [...TOOLS, ...Object.values(VARIANTS)].find((t) => t.action === String(action) && manageFlag.ACTIONS.includes(t.action))
        || require('./workTools').TOOLS.find((t) => t.action === String(action) && t.grant);
    return tool && tool.grant ? tool.grant : null;
};

module.exports = { TOOLS, VARIANTS, SCOPES, SEARCH_INPUT, BATCH_MAX, BATCH_AT_ONCE_MAX, batchNotWaiting, offered, variantOf, searchFilter, planBrief, grantOfAction };

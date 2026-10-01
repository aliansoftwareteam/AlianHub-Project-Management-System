const copy = require('../ProjectDuplicate/rules');

const MAX_TASKS = 2000;
const MAX_TEMPLATES = 100;
const MAX_DESCRIPTION = 2000;
const MAX_CODE = 10;
const TASKS_PER_ROW = 25;
const DAY_MS = 24 * 60 * 60 * 1000;
const LATEST_START = Date.UTC(2200, 0, 1);
const TEMPLATE = 'template';
const TASKS = 'tasks';
const TEAM_PREFIX = 'tId_';
const PRIVATE_LISTS_LEFT = 'private_lists_left';

const INCLUDE_KEYS = ['tasks', 'assignees', 'dates', 'automations'];
const DEADLINES = 'dueDateDeadLine';
const FIRST_STATUS = 'default_active';
const STATUS_FIELDS = ['status', 'statusKey', 'statusType'];
const TASK_KEPT = copy.TASK_FIELDS.filter((field) => !STATUS_FIELDS.includes(field));
const PLAIN_ICON = Object.freeze({ type: 'color', data: '#2F3990' });
const NEVER_STORED_FIELD_TYPES = ['files'];
const SET_WHEN_USED = ['CompanyId', 'LeadUserId', 'projectCreatedBy'];

const { isPlainObject, refusal } = copy;

const includeOf = (body) => {
    if (!isPlainObject(body.include)) return refusal(`include is required: { ${INCLUDE_KEYS.join(', ')} }, each true or false.`);
    const stray = Object.keys(body.include).find((key) => !INCLUDE_KEYS.includes(key));
    if (stray) return refusal(`include.${stray} is not something a template takes.`);
    const notBoolean = INCLUDE_KEYS.find((key) => typeof body.include[key] !== 'boolean');
    if (notBoolean) return refusal(`include.${notBoolean} must be true or false.`);
    return { ok: true, include: copy.pick(body.include, INCLUDE_KEYS) };
};

const nameOf = (body) => {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    return !name || name.length > copy.MAX_NAME ? refusal(`name is required, as text of at most ${copy.MAX_NAME} characters.`) : { ok: true, name };
};

const descriptionOf = (body) => (typeof body.description !== 'string' || body.description.trim().length > MAX_DESCRIPTION
    ? refusal(`description must be text of at most ${MAX_DESCRIPTION} characters.`)
    : { ok: true, description: body.description.trim() });

const flagOf = (body, key) => (typeof body[key] === 'boolean' ? { ok: true, [key]: body[key] } : refusal(`${key} must be true or false.`));

const codeOf = (body) => {
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    return /^[A-Z0-9]+$/.test(code) && code.length <= MAX_CODE ? { ok: true, code } : refusal(`code must be letters and digits, at most ${MAX_CODE} of them.`);
};

const startOf = (body) => {
    const start = typeof body.startDate === 'string' ? new Date(body.startDate).getTime() : NaN;
    return start >= 0 && start <= LATEST_START ? { ok: true, start } : refusal('startDate must be a date.');
};

/* Every part that is sent must pass; the first refusal is the answer. `required` parts must be sent. */
const parse = (body, parts, required, what) => {
    if (!isPlainObject(body)) return refusal(`${what} takes an object.`);
    const unknown = Object.keys(body).find((key) => !Object.prototype.hasOwnProperty.call(parts, key));
    if (unknown) return refusal(`${unknown} is not something ${what} takes.`);
    const sent = Object.keys(parts).filter((key) => required.includes(key) || body[key] !== undefined);
    const read = sent.map((key) => parts[key](body, key));
    return read.find((part) => !part.ok) || Object.assign({ ok: true }, ...read);
};

const parseSave = (body) => parse(body, { name: nameOf, include: includeOf, description: descriptionOf, everyone: flagOf }, ['name', 'include'], 'saving a template');

const parseEdit = (body) => {
    const request = parse(body, { name: nameOf, description: descriptionOf, everyone: flagOf }, [], 'a template edit');
    if (!request.ok) return request;
    const { ok, ...changes } = request;
    return Object.keys(changes).length ? { ok, changes } : refusal('Nothing to change: send a name, a description or everyone.');
};

const parseUse = (body) => parse(body, { name: nameOf, include: includeOf, code: codeOf, isPrivate: flagOf, startDate: startOf }, ['name', 'include'], 'using a template');

const without = (row, keys) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));

const instantOf = (value) => {
    const at = value == null || value === '' ? NaN : new Date(value).getTime();
    return Number.isFinite(at) ? at : null;
};

/* Offsets are counted from midnight, so a start with no hour of its own must be one too: the day in UTC, which a client that knows
   the reader's time zone replaces by sending startDate. */
const startOfDay = (at) => at - (at % DAY_MS);

/* Dates leave a row as milliseconds from the project's start, so a project made later lays them out from its own. */
const withOffsets = (row, fields, anchor) => {
    const offsets = {};
    fields.forEach((field) => {
        if (field === DEADLINES) {
            const steps = (Array.isArray(row[field]) ? row[field] : []).map((entry) => instantOf(entry && entry.date)).filter((at) => at !== null);
            if (steps.length) offsets[field] = steps.map((at) => at - anchor);
            return;
        }
        const at = instantOf(row[field]);
        if (at !== null) offsets[field] = at - anchor;
    });
    return Object.keys(offsets).length ? { ...without(row, fields), dateOffsets: offsets } : without(row, fields);
};

/* The dates come back relative to `start`; with no start the row is left without any. */
const withDates = ({ dateOffsets, ...row }, start) => {
    if (start === null || !isPlainObject(dateOffsets)) return row;
    const dates = Object.entries(dateOffsets).map(([field, offset]) => [
        field,
        field === DEADLINES ? offset.map((step) => ({ date: new Date(start + step) })) : new Date(start + offset),
    ]);
    return { ...row, ...Object.fromEntries(dates) };
};

const untick = (value) => {
    if (Array.isArray(value)) return value.map(untick);
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'isChecked' ? false : untick(item)]));
};

/* A field value stays when its field still means something in the project: a company-wide field, or one linked to it. People
   named by a field of a task come along only with the assignees; the ones on the project's own fields never do. */
const fieldValues = (customField, { definitions, linked, withPeople }) => Object.fromEntries(
    Object.entries(isPlainObject(customField) ? customField : {}).filter(([fieldId]) => {
        const definition = definitions.get(fieldId);
        if (!definition || NEVER_STORED_FIELD_TYPES.includes(definition.fieldType)) return false;
        if (definition.fieldType === 'people' && !withPeople) return false;
        return definition.global === true || !Array.isArray(definition.projectId) || linked.has(fieldId);
    }),
);

const fieldIdsIn = (rows) => rows.flatMap((row) => Object.keys((row && isPlainObject(row.customField) && row.customField) || {}));

const peopleIn = (rows) => rows.flatMap((row) => [
    ...(row.AssigneeUserId || []),
    ...(row.checklistArray || []).flatMap((item) => (item && item.AssigneeUserId) || []),
]).map(String);

/* An uploaded icon is a file of the source project, so only a colour comes along. */
const colourIcon = (icon) => (isPlainObject(icon) && icon.type === 'color' ? icon : undefined);

/* The rows a duplicate would write for `bundle`, kept instead of written. Every id is new, so the template names nothing of the
   project it came from, and the same copy functions make a project out of these rows later. */
const frozenStructure = (bundle, { name, caller, companyId, include, anchor, fields }) => {
    const projectRef = copy.newId();
    const projectId = String(projectRef);
    const ids = new Map([[String(bundle.source._id), projectId]]);
    const { copies: folderRows, moved } = copy.folderCopies(bundle.folders, projectRef, ids);
    const listRows = copy.listCopies(bundle.lists, projectRef, ids, include);
    const projectRow = without(copy.projectCopy(bundle.source, {
        id: projectRef, name, code: bundle.source.ProjectCode, caller, companyId, include, ids,
    }), SET_WHEN_USED);

    const lists = listRows.map((list) => withOffsets({
        ...without(list, ['projectId']),
        _id: String(list._id),
        ...(list.folderId ? { folderId: String(list.folderId) } : {}),
        AssigneeUserId: include.assignees && list.private !== true ? (list.AssigneeUserId || []).map(String) : [],
    }, copy.LIST_DATES, anchor));
    const project = withOffsets({
        ...projectRow,
        _id: projectId,
        projectIcon: colourIcon(projectRow.projectIcon),
        customField: fieldValues(projectRow.customField, { ...fields, withPeople: false }),
        AssigneeUserId: include.assignees ? (bundle.source.AssigneeUserId || []).map(String) : [],
    }, copy.PROJECT_DATES, anchor);

    return {
        ids,
        notes: moved.map((folderName) => ({ code: 'subfolder_moved_to_top', name: folderName })),
        holdsPrivate: bundle.source.isPrivateSpace === true || lists.some((list) => list.private === true),
        snapshot: {
            project,
            folders: folderRows.map((folder) => ({
                ...without(folder, ['projectId']), _id: String(folder._id), ...(folder.parentFolderId ? { parentFolderId: String(folder.parentFolderId) } : {}),
            })),
            lists,
            permissions: copy.permissionCopies(bundle.permissions, projectId).map((row) => ({ ...row, _id: String(row._id) })),
            rules: bundle.rules.map((rule) => {
                const kept = copy.ruleCopy(rule, { projectId, caller, ids });
                return { ...without(kept, ['createdBy']), _id: String(kept._id) };
            }),
            fieldIds: bundle.fieldIds,
            people: [...new Set(peopleIn([project, ...lists]))],
        },
    };
};

/* A task as the template keeps it: no status (it starts in the project's first one), nothing ticked, and of its dates only how far
   they are from the project's start. */
const frozenTask = (row, { ids, include, anchor, fields }) => {
    const checklist = include.assignees ? row.checklistArray : copy.withoutPeople(row.checklistArray);
    const kept = copy.remap({
        _id: String(row._id),
        ParentTaskId: row.ParentTaskId ? String(row.ParentTaskId) : '',
        sprintId: String(row.sprintId),
        ...copy.pick(row, TASK_KEPT),
        customField: fieldValues(row.customField, { ...fields, withPeople: include.assignees }),
        AssigneeUserId: include.assignees ? (row.AssigneeUserId || []).map(String) : [],
        ...(Array.isArray(row.checklistArray) ? { checklistArray: untick(checklist) } : {}),
    }, ids);
    return withOffsets({ ...kept, ...(include.dates ? copy.pick(row, copy.TASK_DATES) : {}) }, copy.TASK_DATES, anchor);
};

const firstStatusOf = (statuses) => statuses.find((status) => status && status.type === FIRST_STATUS) || statuses[0] || null;

/* The statuses of the template the company still has; the one tasks start in always stays, so a project is never left without it. */
const usableStatuses = (statuses, companyKeys) => {
    const all = Array.isArray(statuses) ? statuses : [];
    if (!companyKeys) return { statuses: all, skipped: 0 };
    const first = firstStatusOf(all);
    const kept = all.filter((status) => status === first || companyKeys.has(String(status && status.key)));
    return { statuses: kept, skipped: all.length - kept.length };
};

/* The stored rows as the copy functions read a source: dates laid out from `start` (null for none), people who are still here,
   the statuses and fields that still exist. */
const thawedBundle = (snapshot, { caller, include, start, isPrivate, gone, statuses, fields }) => {
    const here = (ids) => (include.assignees ? (ids || []).map(String).filter((id) => !gone.has(id)) : []);
    const isPrivateSpace = typeof isPrivate === 'boolean' ? isPrivate : snapshot.project.isPrivateSpace === true;
    const members = isPrivateSpace ? snapshot.people : snapshot.project.AssigneeUserId;
    return {
        source: {
            ...withDates({
                ...snapshot.project,
                isPrivateSpace,
                taskStatusData: statuses,
                projectIcon: snapshot.project.projectIcon || PLAIN_ICON,
                customField: fieldValues(snapshot.project.customField, { ...fields, withPeople: false }),
                AssigneeUserId: [...new Set([...here(members), caller])],
            }, start),
            ...(start === null ? {} : { StartDate: new Date(start) }),
        },
        folders: snapshot.folders,
        lists: snapshot.lists.map((list) => withDates({ ...list, AssigneeUserId: list.private === true ? [caller] : here(list.AssigneeUserId) }, start)),
        permissions: snapshot.permissions,
        rules: include.automations ? snapshot.rules : [],
        fieldIds: [...fields.linked],
        notes: [],
    };
};

const thawedTask = (row, { include, start, gone, first, fields }) => {
    const here = (ids) => (include.assignees ? (ids || []).map(String).filter((id) => !gone.has(id)) : []);
    const checklist = (row.checklistArray || []).map((item) => (isPlainObject(item) && item.AssigneeUserId ? { ...item, AssigneeUserId: here(item.AssigneeUserId) } : item));
    return withDates({
        ...row,
        ...(first ? { status: { key: first.key, text: first.name, type: first.type }, statusKey: first.key, statusType: first.type } : {}),
        customField: fieldValues(row.customField, { ...fields, withPeople: include.assignees }),
        AssigneeUserId: here(row.AssigneeUserId),
        ...(Array.isArray(row.checklistArray) ? { checklistArray: checklist } : {}),
    }, start);
};

/* A template offered to everyone holds no private list: such a list stays behind with its tasks, counted with the ones the person
   saving is not on. */
const withoutPrivateLists = (bundle) => {
    const lists = bundle.lists.filter((list) => list.private !== true);
    const left = bundle.lists.length - lists.length;
    if (!left) return bundle;
    const counted = bundle.notes.filter((note) => note.code === PRIVATE_LISTS_LEFT).reduce((sum, note) => sum + note.count, 0);
    return { ...bundle, lists, notes: [...bundle.notes.filter((note) => note.code !== PRIVATE_LISTS_LEFT), { code: PRIVATE_LISTS_LEFT, count: counted + left }] };
};

const holdsPrivateList = (template) => ((template.snapshot && template.snapshot.lists) || []).some((list) => list.private === true);

const isCreator = (template, caller) => String(template.createdBy) === String(caller);

/* Offering a template to everyone is for the person who saved it; owners and admins may do it too for one that came from a
   public project. */
const mayOffer = (template, caller, privileged) => isCreator(template, caller) || (privileged && template.sourcePrivate !== true);

const canSee = (template, caller, privileged) => privileged || template.everyone === true || isCreator(template, caller);
const canManage = (template, caller, privileged) => privileged || isCreator(template, caller);

const presented = (template, caller, privileged) => ({
    _id: String(template._id),
    name: template.name,
    description: template.description || '',
    everyone: template.everyone === true,
    sourcePrivate: template.sourcePrivate === true,
    include: template.include || {},
    counts: template.counts || {},
    statuses: template.statuses || [],
    createdBy: String(template.createdBy || ''),
    createdAt: template.createdAt || null,
    canManage: canManage(template, caller, privileged),
});

module.exports = {
    MAX_TASKS, MAX_TEMPLATES, TASKS_PER_ROW, TEMPLATE, TASKS, TEAM_PREFIX, INCLUDE_KEYS, startOfDay,
    parseSave, parseEdit, parseUse, withOffsets, withDates, fieldValues, fieldIdsIn, peopleIn,
    frozenStructure, frozenTask, firstStatusOf, usableStatuses, thawedBundle, thawedTask,
    withoutPrivateLists, holdsPrivateList, mayOffer, canSee, canManage, presented,
};

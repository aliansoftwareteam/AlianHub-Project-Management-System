const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { evaluatePermission, isReadable } = require('../../../Config/permissionGuard');
const relationship = require('../fieldTypes/relationship');
const voting = require('../fieldTypes/voting');
const { customFieldDefinitionOf, customFieldDefinitionsOf } = require('./customFieldText');
const { fieldAppliesToTask } = require('./fieldTaskTypes');
const { isTaskFieldOf } = require('./fieldValueInput');
const { RELATIONSHIP, VOTING, oid, pathOf, linkDocs, storedIds, saveIds, markerOf, markTask, changeVote, storeTally } = require('./fieldLinkStore');
const { openableTasks } = require('../../Tasks/helpers/taskReadAccess');
const { QueryRefused } = require('../../Tasks/helpers/taskQueryGuard');

/* Who may read and write what helpers/fieldLinkStore.js keeps. */

const CONDITION = 'fieldLinks';
const CONDITIONS_MAX = 10;
const RESOLVE_MAX = 200;
/* A writer keeps the links they cannot see, so a field can hold more than its cap; it never holds more than this. */
const STORED_MAX = 100;
/* A query that names more projects than this is answered from the field's links across the company. */
const BOUNDED_PROJECTS_MAX = 50;
const FIELD_PERMISSION = 'task.task_custom_field';

const NOT_OPENABLE = 'A task named here is not one you can open.';
const OUT_OF_SCOPE = 'A task named here is outside the project or list this field links to.';
const ITSELF = 'A task cannot be linked to itself.';
const FULL = 'This field cannot hold more linked tasks.';
const NOT_FOUND = 'not_found';
const NOT_A_VOTING_FIELD = 'not_a_voting_field';
const FIELDS_HIDDEN = 'fields_hidden';

const LINK_FIELDS = Object.freeze({ TaskName: 1, TaskKey: 1, status: 1, statusKey: 1, statusType: 1, ProjectID: 1, sprintId: 1, folderObjId: 1 });
const VOTED_TASK_FIELDS = Object.freeze({ ProjectID: 1, TaskTypeKey: 1 });

const { isId } = relationship;
const idOf = (row) => String(row._id);
const text = (value) => (value === undefined || value === null ? '' : String(value));

const inScope = (definition, row) => {
    const { scope, projectId, sprintId } = relationship.scopeOf(definition);
    if (scope === 'any') return true;
    if (text(row.ProjectID).toLowerCase() !== projectId) return false;
    return scope === 'project' || text(row.sprintId).toLowerCase() === sprintId;
};

/* The writer sends the links they see. A link they cannot see (a task they cannot open, or one that is deleted or archived)
 * stays where it is; every task they send must be one they can open, and a new one must fit the field's limit. Answers the
 * marker to store on the task, or { error }, which reads the same for a task that does not exist as for one out of reach. */
const writeLinks = async ({ companyId, actorId, task, definition, ids }) => {
    const taskId = task && task._id ? String(task._id) : '';
    if (!isId(taskId)) return { error: NOT_OPENABLE };
    const fieldId = String(definition._id);
    const stored = await storedIds(companyId, { taskId, fieldId, kind: RELATIONSHIP });
    const seen = await openableTasks(companyId, actorId, [...stored, ...ids], { projection: { ProjectID: 1, sprintId: 1 } });
    const open = new Map(seen.map((row) => [idOf(row), row]));
    if (ids.some((id) => !open.has(id))) return { error: NOT_OPENABLE };
    const added = ids.filter((id) => !stored.includes(id));
    if (added.includes(taskId)) return { error: ITSELF };
    if (added.some((id) => !inScope(definition, open.get(id)))) return { error: OUT_OF_SCOPE };
    const next = [...stored.filter((id) => !open.has(id) || ids.includes(id)), ...added];
    if (next.length > STORED_MAX) return { error: FULL };
    await saveIds(companyId, { taskId, fieldId, kind: RELATIONSHIP, ids: next });
    return { detail: markerOf(fieldId) };
};

const statusOf = (row) => {
    let status = row.status;
    if (typeof status === 'string') {
        try { status = JSON.parse(status); } catch (_error) { status = null; }
    }
    const held = status && typeof status === 'object' ? status : {};
    return { key: row.statusKey === undefined ? (held.key === undefined ? null : held.key) : row.statusKey, text: text(held.text), type: text(row.statusType || held.type) };
};

const linkOf = (row) => ({
    id: idOf(row), key: text(row.TaskKey), title: text(row.TaskName), status: statusOf(row),
    projectId: text(row.ProjectID), sprintId: text(row.sprintId), folderId: text(row.folderObjId),
});

const tallyOf = (doc, definition, uid) => ({
    count: doc.ids.length,
    voted: doc.ids.includes(String(uid)),
    ...(voting.votersShown(definition) ? { voters: doc.ids } : {}),
});

/* What `uid` is shown of these tasks' relationship and voting fields: { taskId: { fieldId: value } }. A task they cannot
 * open is left out as if it held nothing, a linked task they cannot open is left out of its list with no count of what
 * was left out, and voters are named only when the field shows them. */
const resolveFor = async ({ companyId, uid, taskIds }) => {
    const wanted = [...new Set((Array.isArray(taskIds) ? taskIds : []).filter(isId).map((id) => id.toLowerCase()))].slice(0, RESOLVE_MAX);
    const sources = (await openableTasks(companyId, uid, wanted, { live: false })).map(idOf);
    if (!sources.length) return {};
    const docs = (await linkDocs(companyId, { taskId: { $in: sources } })).filter((doc) => doc.ids.length);
    const definitions = await customFieldDefinitionsOf(companyId, docs.map((doc) => doc.fieldId));
    const typed = docs.filter((doc) => (definitions.get(doc.fieldId) || {}).fieldType === doc.kind);
    const targets = typed.filter((doc) => doc.kind === RELATIONSHIP).flatMap((doc) => doc.ids);
    const shown = new Map((await openableTasks(companyId, uid, targets, { projection: LINK_FIELDS })).map((row) => [idOf(row), linkOf(row)]));
    const resolved = {};
    typed.forEach((doc) => {
        const value = doc.kind === RELATIONSHIP
            ? doc.ids.map((id) => shown.get(id)).filter(Boolean)
            : tallyOf(doc, definitions.get(doc.fieldId), uid);
        if (Array.isArray(value) && !value.length) return;
        resolved[doc.taskId] = { ...(resolved[doc.taskId] || {}), [doc.fieldId]: value };
    });
    return resolved;
};

/* One person's own vote on one task, cast as the caller and nobody else. It needs the right to open the task and to see
 * its custom fields: a role the permission matrix gives no access to them is shown no field at all, this one included. */
const castVote = async ({ companyId, uid, taskId, fieldId, vote }) => {
    const voter = String(uid || '');
    const [task] = isId(taskId) && isId(voter) ? await openableTasks(companyId, voter, [taskId], { projection: VOTED_TASK_FIELDS }) : [];
    if (!task) return { refused: NOT_FOUND };
    if (!isReadable(await evaluatePermission(companyId, voter, FIELD_PERMISSION, { projectId: text(task.ProjectID) }))) return { refused: FIELDS_HIDDEN };
    const definition = isId(fieldId) ? await customFieldDefinitionOf(companyId, fieldId) : null;
    if (!definition || definition.fieldType !== VOTING || !isTaskFieldOf(definition, task.ProjectID) || !fieldAppliesToTask(definition, task)) return { refused: NOT_A_VOTING_FIELD };
    const after = await changeVote(companyId, { taskId: idOf(task), fieldId: String(definition._id) }, voter, vote === true);
    if (!after) return { count: 0, voted: false };
    await storeTally(companyId, after);
    return { count: after.ids.length, voted: after.ids.includes(voter) };
};

const sourcesOf = (docs) => [...new Set(docs.map((doc) => doc.taskId))].filter(isId);

const isObjectId = (value) => Boolean(value) && value._bsontype === 'ObjectId';
const namesIds = (list) => Array.isArray(list) && list.length > 0 && list.every((id) => isObjectId(id) || isId(id));

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/* Every condition a match requires at once: its own keys, and those of each part of its $and. */
const required = (match) => [match, ...(Array.isArray(match.$and) ? match.$and.filter(isPlainObject).flatMap(required) : [])];

const projectIdsOf = (condition) => {
    if (isObjectId(condition) || isId(condition)) return [String(condition)];
    const only = isPlainObject(condition) && Object.keys(condition).length === 1 ? condition : {};
    if (namesIds(only.$in)) return only.$in.map(String);
    return isObjectId(only.$eq) || isId(only.$eq) ? [String(only.$eq)] : null;
};

/* The projects a task query keeps to, read from what its first stage requires of ProjectID; null when it names none
 * or too many. Every later stage only narrows, so a task outside them is never in the answer. */
const projectsOf = (stages) => {
    const first = Array.isArray(stages) && isPlainObject(stages[0]) ? stages[0].$match : null;
    if (!isPlainObject(first)) return null;
    const named = required(first).filter((part) => 'ProjectID' in part).map((part) => projectIdsOf(part.ProjectID)).filter(Boolean);
    const fewest = named.sort((a, b) => a.length - b.length)[0];
    return fewest && fewest.length <= BOUNDED_PROJECTS_MAX ? fewest : null;
};

/* The relationship values a "has a value" question reads. Inside named projects they are those of the tasks that carry
 * the field's marker there, found through the tasks' own project so a moved task is never missed. */
const relationshipDocs = async (companyId, fieldId, projects) => {
    const held = { fieldId, kind: RELATIONSHIP, 'ids.0': { $exists: true } };
    if (!projects) return linkDocs(companyId, held);
    const marked = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ ProjectID: { $in: projects.map(oid) }, [pathOf(fieldId)]: { $exists: true } }, { _id: 1 }, { lean: true }],
    }, 'find');
    return marked && marked.length ? linkDocs(companyId, { ...held, taskId: { $in: marked.map(idOf) } }) : [];
};

/* The tasks a filter or a group on one of these fields asks for, as this viewer would see them. */
const sourcesFor = async ({ companyId, uid, projects, field, is, task }) => {
    const fieldId = isId(field) ? field.toLowerCase() : '';
    if (!fieldId) throw new QueryRefused(CONDITION, 'it must name a custom field');
    if (is === 'mine') return sourcesOf(await linkDocs(companyId, { fieldId, kind: VOTING, ids: String(uid) }));
    if (is === 'has') {
        if (!isId(task)) throw new QueryRefused(CONDITION, 'it must name the linked task to look for');
        const [open] = await openableTasks(companyId, uid, [task]);
        return open ? sourcesOf(await linkDocs(companyId, { fieldId, kind: RELATIONSHIP, ids: idOf(open) })) : [];
    }
    if (is !== 'set' && is !== 'empty') throw new QueryRefused(CONDITION, 'it must ask for set, empty, has or mine');
    const docs = await relationshipDocs(companyId, fieldId, projects);
    const open = new Set((await openableTasks(companyId, uid, docs.flatMap((doc) => doc.ids))).map(idOf));
    return sourcesOf(docs.filter((doc) => doc.ids.some((id) => open.has(id))));
};

const isCondition = (value) => isPlainObject(value) && Object.keys(value).length === 1 && isPlainObject(value[CONDITION]);

/* A task query cannot read these values off the task, so a filter or a group names them as
 * { _id: { fieldLinks: { field, is: 'set' | 'empty' | 'has' | 'mine', task } } }, and that is answered here, per viewer,
 * as the ids of the tasks that qualify. The query then runs under the caller's own visibility like any other. */
const withLinkConditions = async (companyId, uid, stages) => {
    let conditions = 0;
    const projects = projectsOf(stages);
    /* A grouped view asks the same question in its rows, its counts and its "no value" group. */
    const answered = new Map();
    const sourcesOnce = (condition) => {
        const asked = JSON.stringify([condition.field, condition.is, condition.task]);
        if (!answered.has(asked)) answered.set(asked, sourcesFor({ companyId, uid, projects, ...condition }));
        return answered.get(asked);
    };
    const walk = async (value) => {
        if (Array.isArray(value)) {
            const items = [];
            for (const item of value) items.push(await walk(item));
            return items;
        }
        if (!isPlainObject(value)) return value;
        if (isCondition(value)) {
            conditions += 1;
            if (conditions > CONDITIONS_MAX) throw new QueryRefused(CONDITION, `at most ${CONDITIONS_MAX} are accepted`);
            const ids = (await sourcesOnce(value[CONDITION])).map(oid);
            return value[CONDITION].is === 'empty' ? { $nin: ids } : { $in: ids };
        }
        const walked = {};
        for (const [key, inner] of Object.entries(value)) walked[key] = await walk(inner);
        return walked;
    };
    return walk(stages);
};

/* The links of copied tasks, for the person copying: `pairs` maps each source task to its copy. A link to a task inside
 * the copied set points at that task's copy; a link outside it is kept when the person can open the task. Votes are not
 * copied. A copy is marked whenever its source held links at all, so the marker says nothing about what was kept. */
const copyFieldLinks = async ({ companyId, actorId, pairs, announce = true }) => {
    const copies = new Map([...pairs].map(([source, copy]) => [String(source), String(copy)]));
    if (!copies.size) return 0;
    const docs = await linkDocs(companyId, { taskId: { $in: [...copies.keys()] }, kind: RELATIONSHIP });
    if (!docs.length) return 0;
    const open = new Set((await openableTasks(companyId, actorId, docs.flatMap((doc) => doc.ids).filter((id) => !copies.has(id)))).map(idOf));
    for (const doc of docs) {
        const taskId = copies.get(doc.taskId);
        const ids = [...new Set(doc.ids.map((id) => copies.get(id) || (open.has(id) ? id : '')).filter(Boolean))];
        await saveIds(companyId, { taskId, fieldId: doc.fieldId, kind: RELATIONSHIP, ids });
        await markTask(companyId, { taskId, fieldId: doc.fieldId, marker: markerOf(doc.fieldId), announce });
    }
    return docs.length;
};

module.exports = {
    CONDITION, RESOLVE_MAX, NOT_FOUND, NOT_A_VOTING_FIELD, FIELDS_HIDDEN,
    writeLinks, resolveFor, castVote, withLinkConditions, copyFieldLinks,
};

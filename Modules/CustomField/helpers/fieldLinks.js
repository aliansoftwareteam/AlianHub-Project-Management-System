const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../../event/socketEventEmitter');
const relationship = require('../fieldTypes/relationship');
const voting = require('../fieldTypes/voting');
const { customFieldDefinitionOf, customFieldDefinitionsOf } = require('./customFieldText');
const { fieldAppliesToTask } = require('./fieldTaskTypes');
const { isTaskFieldOf } = require('./fieldValueInput');
const { openableTasks } = require('../../Tasks/helpers/taskReadAccess');
const { QueryRefused } = require('../../Tasks/helpers/taskQueryGuard');

/* What a relationship or a voting field holds on one task is kept here, not on the task: a task document goes whole to
 * everyone who can open that task (the task query, the socket, webhooks), and a linked task or a voter is shown only to
 * a viewer entitled to it. The task itself carries a marker, { _id, fieldValue, revision }: fieldValue is '' for a
 * relationship and the number of votes for a voting field, and revision moves on every write so an open view asks again. */

const RELATIONSHIP = relationship.type;
const VOTING = voting.type;
const CONDITION = 'fieldLinks';
const CONDITIONS_MAX = 10;
const RESOLVE_MAX = 200;
/* A writer keeps the links they cannot see, so a field can hold more than its cap; it never holds more than this. */
const STORED_MAX = 100;

const NOT_OPENABLE = 'A task named here is not one you can open.';
const OUT_OF_SCOPE = 'A task named here is outside the project or list this field links to.';
const ITSELF = 'A task cannot be linked to itself.';
const FULL = 'This field cannot hold more linked tasks.';
const NOT_FOUND = 'not_found';
const NOT_A_VOTING_FIELD = 'not_a_voting_field';

const LINK_FIELDS = Object.freeze({ TaskName: 1, TaskKey: 1, status: 1, statusKey: 1, statusType: 1, ProjectID: 1, sprintId: 1, folderObjId: 1 });
const VOTED_TASK_FIELDS = Object.freeze({ ProjectID: 1, TaskTypeKey: 1 });

const { isId } = relationship;
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const idOf = (row) => String(row._id);
const text = (value) => (value === undefined || value === null ? '' : String(value));
const pathOf = (fieldId) => `customField.${fieldId}`;

const linkDocs = async (companyId, filter) => ((await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.CUSTOM_FIELD_LINKS, data: [filter] }, 'find')) || [])
    .map(plain)
    .map((doc) => ({ ...doc, ids: (doc.ids || []).map(String) }));

/* A field whose type was changed leaves ids of the other kind behind; they are never read as this kind. */
const storedIds = async (companyId, { taskId, fieldId, kind }) => {
    const [doc] = await linkDocs(companyId, { taskId, fieldId, kind });
    return doc ? doc.ids : [];
};

const DUPLICATE_KEY = 11000;

/* Two first writes for one task and field both try to insert, and the unique index refuses the later one; run again, it updates. */
const upserting = (write) => write().catch((error) => (error && error.code === DUPLICATE_KEY ? write() : Promise.reject(error)));

const saveIds = (companyId, { taskId, fieldId, kind, ids }) => upserting(() => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.CUSTOM_FIELD_LINKS,
    data: [{ taskId, fieldId }, { $set: { kind, ids } }, { upsert: true, returnDocument: 'after' }],
}, 'findOneAndUpdate'));

let lastRevision = 0;
const nextRevision = () => {
    lastRevision = Math.max(Date.now(), lastRevision + 1);
    return lastRevision;
};

const markerOf = (fieldId, fieldValue = '') => ({ _id: String(fieldId), fieldValue, revision: nextRevision() });

const markTask = async (companyId, { taskId, fieldId, marker, announce = true }) => {
    const change = marker ? { $set: { [pathOf(fieldId)]: marker } } : { $unset: { [pathOf(fieldId)]: '' } };
    const updated = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: oid(taskId) }, change, { returnDocument: 'after' }] }, 'findOneAndUpdate');
    if (updated && announce) socketEmitter.emit('update', { type: 'update', data: updated, updatedFields: { [pathOf(fieldId)]: marker || null }, module: 'task' });
    return updated;
};

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

const votersOf = async (companyId, key) => storedIds(companyId, { ...key, kind: VOTING });

/* One person's own vote on one task. It needs the right to open the task and nothing more, and the voter is always the
 * caller. The count on the task is what the stored voters number once the vote is in. */
const castVote = async ({ companyId, uid, taskId, fieldId, vote }) => {
    const voter = String(uid || '');
    const [task] = isId(taskId) && isId(voter) ? await openableTasks(companyId, voter, [taskId], { projection: VOTED_TASK_FIELDS }) : [];
    if (!task) return { refused: NOT_FOUND };
    const definition = isId(fieldId) ? await customFieldDefinitionOf(companyId, fieldId) : null;
    if (!definition || definition.fieldType !== VOTING || !isTaskFieldOf(definition, task.ProjectID) || !fieldAppliesToTask(definition, task)) return { refused: NOT_A_VOTING_FIELD };
    const key = { taskId: idOf(task), fieldId: String(definition._id) };
    await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.CUSTOM_FIELD_LINKS, data: [{ ...key, kind: { $ne: VOTING } }, { $set: { kind: VOTING, ids: [] } }] }, 'updateOne');
    await upserting(() => MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.CUSTOM_FIELD_LINKS,
        data: [key, vote ? { $addToSet: { ids: voter }, $set: { kind: VOTING } } : { $pull: { ids: voter } }, { upsert: vote === true }],
    }, 'updateOne'));
    const store = async () => {
        const count = (await votersOf(companyId, key)).length;
        await markTask(companyId, { ...key, marker: count ? markerOf(key.fieldId, count) : null });
        return count;
    };
    let count = await store();
    /* Two people voting at once each store the count they read; the later read settles it. */
    if ((await votersOf(companyId, key)).length !== count) count = await store();
    return { count, voted: vote === true };
};

const sourcesOf = (docs) => [...new Set(docs.map((doc) => doc.taskId))].filter(isId);

/* The tasks a filter or a group on one of these fields asks for, as this viewer would see them. */
const sourcesFor = async ({ companyId, uid, field, is, task }) => {
    const fieldId = isId(field) ? field.toLowerCase() : '';
    if (!fieldId) throw new QueryRefused(CONDITION, 'it must name a custom field');
    if (is === 'mine') return sourcesOf(await linkDocs(companyId, { fieldId, kind: VOTING, ids: String(uid) }));
    if (is === 'has') {
        if (!isId(task)) throw new QueryRefused(CONDITION, 'it must name the linked task to look for');
        const [open] = await openableTasks(companyId, uid, [task]);
        return open ? sourcesOf(await linkDocs(companyId, { fieldId, kind: RELATIONSHIP, ids: idOf(open) })) : [];
    }
    if (is !== 'set' && is !== 'empty') throw new QueryRefused(CONDITION, 'it must ask for set, empty, has or mine');
    const docs = await linkDocs(companyId, { fieldId, kind: RELATIONSHIP });
    const open = new Set((await openableTasks(companyId, uid, docs.flatMap((doc) => doc.ids))).map(idOf));
    return sourcesOf(docs.filter((doc) => doc.ids.some((id) => open.has(id))));
};

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));

const isCondition = (value) => isPlainObject(value) && Object.keys(value).length === 1 && isPlainObject(value[CONDITION]);

/* A task query cannot read these values off the task, so a filter or a group names them as
 * { _id: { fieldLinks: { field, is: 'set' | 'empty' | 'has' | 'mine', task } } }, and that is answered here, per viewer,
 * as the ids of the tasks that qualify. The query then runs under the caller's own visibility like any other. */
const withLinkConditions = async (companyId, uid, stages) => {
    let conditions = 0;
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
            const ids = (await sourcesFor({ companyId, uid, ...value[CONDITION] })).map(oid);
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
    CONDITION, RESOLVE_MAX, NOT_FOUND, NOT_A_VOTING_FIELD,
    writeLinks, resolveFor, castVote, withLinkConditions, copyFieldLinks,
};

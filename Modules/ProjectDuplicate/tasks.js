const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { MAX_DEPTH, ancestorsFor, canNest } = require('../Tasks/helpers/taskTree');
const { storableFieldValues } = require('../CustomField/helpers/fieldValueWrite');
const { copyFieldLinks } = require('../CustomField/helpers/fieldLinks');
const logger = require('../../Config/loggerConfig');
const rules = require('./rules');

const asId = (id) => new mongoose.Types.ObjectId(String(id));
const chunks = (rows, size) => Array.from({ length: Math.ceil(rows.length / size) }, (unused, at) => rows.slice(at * size, (at + 1) * size));

/* The levels a copy keeps of `rows` (ids and parents), and how many rows it leaves out. */
const planOf = (rows) => {
    const { levels, childrenOf } = rules.taskLevels(rows);
    const kept = levels.slice(0, MAX_DEPTH + 1);
    const total = kept.reduce((sum, level) => sum + level.length, 0);
    return { levels: kept, childrenOf, total, left: rows.length - total };
};

/* Which live tasks of the copied lists will be copied, level by level, read as ids and parents only. */
const planTasks = async (companyId, sourceId, sourceListIds) => {
    if (!sourceListIds.length) return planOf([]);
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ ProjectID: asId(sourceId), sprintId: { $in: sourceListIds.map(asId) }, deletedStatusKey: rules.LIVE, mainChat: { $ne: true } }, { ParentTaskId: 1 }, { lean: true }],
    }, 'find') || [];
    return planOf(rows);
};

/* Reads a batch of planned tasks in full from the project they are copied from. */
const sourceRows = (companyId, sourceId) => async (batch) => (await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TASKS,
    data: [{ _id: { $in: batch.map((row) => row._id) }, ProjectID: asId(sourceId) }, null, { lean: true }],
}, 'find')) || [];

/* The numbers a task create takes from its project: the next keys, and the count of each task type. */
const reserveKeys = async (companyId, projectRef, rows) => {
    const perType = new Map();
    rows.filter((row) => row.TaskTypeKey != null).forEach((row) => perType.set(row.TaskTypeKey, (perType.get(row.TaskTypeKey) || 0) + 1));
    const types = [...perType.keys()];
    const project = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [
            { _id: projectRef },
            { $inc: { lastTaskId: rows.length, ...Object.fromEntries(types.map((key, at) => [`taskTypeCounts.$[t${at}].taskCount`, perType.get(key)])) } },
            { arrayFilters: types.map((key, at) => ({ [`t${at}.key`]: key })), returnDocument: 'after', projection: { lastTaskId: 1 } },
        ],
    }, 'findOneAndUpdate');
    return project.lastTaskId - rows.length;
};

const peopleOf = (row) => [...(row.AssigneeUserId || []).map(String), ...rules.peopleIn(row.checklistArray || [])];

const taskCopy = (row, { parent, key, placement, projectRef, companyId, caller, include, kept, subTasks }) => ({
    ...rules.pick(row, rules.TASK_FIELDS),
    ...(include.dates ? rules.pick(row, rules.TASK_DATES) : {}),
    ...placement,
    _id: rules.newId(),
    TaskKey: key,
    ProjectID: projectRef,
    CompanyId: asId(companyId),
    isParentTask: !parent,
    ParentTaskId: parent ? parent._id : '',
    ancestors: parent ? ancestorsFor(parent) : [],
    subTasks,
    Task_Leader: caller,
    AssigneeUserId: (row.AssigneeUserId || []).filter((id) => kept.has(String(id))),
    watchers: [],
    deletedStatusKey: rules.LIVE,
    ...(row.checklistArray ? { checklistArray: rules.keepingPeople(row.checklistArray, kept) } : {}),
});

const countOnLists = (companyId, docs) => {
    const perList = new Map();
    docs.forEach((doc) => perList.set(String(doc.sprintId), (perList.get(String(doc.sprintId)) || 0) + 1));
    const ops = [...perList].map(([listId, count]) => ({ updateOne: { filter: { _id: asId(listId) }, update: { $inc: { tasks: count } } } }));
    return MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.SPRINTS, data: [ops, { ordered: false }] }, 'bulkWrite');
};

/* Written straight to the collection in batches: the create path would fire the task-created event,
   a notification and two history lines for every row, and run every automation of the company on a copy.
   What that path sets on the server is set here: key, type counts, list counts, chain, subtask count.
   `readRows` answers a batch of the plan in full, from wherever the copy is made. */
const copyTasks = async ({ companyId, caller, copy, plan, include, readRows, onProgress = async () => {} }) => {
    const projectRef = copy.project._id;
    const code = copy.project.ProjectCode;
    const made = new Map();
    const fieldDefinitions = new Map();
    let created = 0;
    for (const [depth, level] of plan.levels.entries()) {
        for (const batch of chunks(level, rules.BATCH)) {
            const rows = await readRows(batch);
            const placed = rows
                .map((row) => ({ row, parent: row.ParentTaskId ? made.get(String(row.ParentTaskId)) : null, placement: copy.placements.get(copy.ids.get(String(row.sprintId))) }))
                .filter(({ row, parent, placement }) => placement && (row.ParentTaskId ? parent && canNest(parent).ok : true));
            if (!placed.length) continue;
            const first = await reserveKeys(companyId, projectRef, placed.map(({ row }) => row));
            // Who a row names is stored on the row, so it is asked again of the project the copy lands in.
            const kept = new Set(include.assignees ? await copy.keepPeople(placed.flatMap(({ row }) => peopleOf(row))) : []);
            const docs = placed.map(({ row, parent, placement }, at) => taskCopy(row, {
                parent, placement, projectRef, companyId, caller, include, kept,
                key: `${code}-${first + at + 1}`,
                subTasks: depth < MAX_DEPTH ? (plan.childrenOf.get(String(row._id)) || []).length : 0,
            }));
            for (const doc of docs) {
                if (doc.customField) doc.customField = (await storableFieldValues({ companyId, task: doc, definitions: fieldDefinitions })).customField;
            }
            await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [docs] }, 'insertMany');
            await countOnLists(companyId, docs);
            placed.forEach(({ row }, at) => made.set(String(row._id), { _id: String(docs[at]._id), ancestors: docs[at].ancestors }));
            created += docs.length;
            await onProgress(created);
        }
    }
    await copyFieldLinks({ companyId, actorId: caller, pairs: new Map([...made].map(([source, copy]) => [source, copy._id])), announce: false })
        .catch((error) => logger.error(`field links copy on project duplicate: ${error && error.message}`));
    return created;
};

module.exports = { chunks, planOf, planTasks, sourceRows, copyTasks };

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { settingsCollectionDocs } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { nonMembersOf, foreignTeamsOf } = require('../../Config/companyMembers');
const { OBJECT_ID } = require('../ProjectDuplicate/rules');
const rules = require('./rules');

const LIVE_TEMPLATE = Object.freeze({ kind: rules.TEMPLATE, deletedStatusKey: 0 });

const asId = (id) => new mongoose.Types.ObjectId(String(id));
const crud = (companyId, data, method) => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECT_SNAPSHOTS, data }, method);

const liveTemplates = async (companyId) => (await crud(companyId, [{ ...LIVE_TEMPLATE }, { snapshot: 0 }, { lean: true }], 'find')) || [];

const liveTemplate = (companyId, id) => (OBJECT_ID.test(String(id || ''))
    ? crud(companyId, [{ _id: asId(id), ...LIVE_TEMPLATE }, null, { lean: true }], 'findOne')
    : Promise.resolve(null));

const countTemplates = async (companyId) => Number(await crud(companyId, [{ ...LIVE_TEMPLATE }], 'countDocuments')) || 0;

const saveTemplate = (companyId, template) => crud(companyId, { ...template, kind: rules.TEMPLATE, deletedStatusKey: 0 }, 'save');

const updateTemplate = (companyId, id, set) => crud(companyId, [{ _id: asId(id), ...LIVE_TEMPLATE }, { $set: set }], 'updateOne');

const deleteTemplate = async (companyId, id, caller) => {
    await updateTemplate(companyId, id, { deletedStatusKey: 1, updatedBy: caller });
    await crud(companyId, [{ kind: rules.TASKS, templateId: asId(id) }, { $set: { deletedStatusKey: 1 } }], 'updateMany');
};

const saveTaskRows = (companyId, templateId, part, tasks) => crud(companyId, [[{ kind: rules.TASKS, templateId, part, tasks, deletedStatusKey: 0 }]], 'insertMany');

const dropTaskRows = (companyId, templateId) => crud(companyId, [{ kind: rules.TASKS, templateId }], 'deleteMany');

/* Every task of a template as its id, its parent and the row that holds it: enough to plan a copy without reading the tasks.
   The rows of a deleted template are not planned from; a copy already under way reads its batches to the end. */
const taskIndex = async (companyId, templateId) => {
    const parts = (await crud(companyId, [{ kind: rules.TASKS, templateId: asId(templateId), deletedStatusKey: 0 }, { part: 1, 'tasks._id': 1, 'tasks.ParentTaskId': 1 }, { lean: true }], 'find')) || [];
    return parts.flatMap((row) => (row.tasks || []).map((task) => ({ _id: task._id, ParentTaskId: task.ParentTaskId, part: row.part })));
};

const tasksOf = async (companyId, templateId, batch) => {
    const wanted = [...new Set(batch.map((row) => row.part))];
    const parts = (await crud(companyId, [{ kind: rules.TASKS, templateId: asId(templateId), part: { $in: wanted } }, null, { lean: true }], 'find')) || [];
    const byId = new Map(parts.flatMap((row) => row.tasks || []).map((task) => [String(task._id), task]));
    return batch.map((row) => byId.get(String(row._id))).filter(Boolean);
};

/* The people and `tId_` teams among `ids` that the company no longer has. */
const absentPeople = async (companyId, ids) => {
    const named = [...new Set((ids || []).map(String))];
    const isTeam = (id) => id.startsWith(rules.TEAM_PREFIX);
    return [
        ...await nonMembersOf(companyId, named.filter((id) => !isTeam(id))),
        ...await foreignTeamsOf(companyId, named.filter(isTeam)),
    ];
};

/* The keys of the task statuses the company has, or null for a company that keeps no list of them. */
const companyStatusKeys = async (companyId) => {
    const settings = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.SETTINGS, data: [{ name: settingsCollectionDocs.TASK_STATUS }, null, { lean: true }] }, 'findOne');
    if (!settings || !Array.isArray(settings.settings)) return null;
    return new Set(settings.settings.filter((status) => status && status.isDeleted !== true).map((status) => String(status.key)));
};

const codeTaken = async (companyId, code) => Boolean(await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ ProjectCode: code }, { _id: 1 }, { lean: true }] }, 'findOne'));

module.exports = {
    liveTemplates, liveTemplate, countTemplates, saveTemplate, updateTemplate, deleteTemplate,
    saveTaskRows, dropTaskRows, taskIndex, tasksOf, absentPeople, companyStatusKeys, codeTaken,
};

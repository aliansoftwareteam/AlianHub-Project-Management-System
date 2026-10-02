const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { canReadProject } = require('../../../Config/projectAccess');
const { readableTasks, TASK_READ_FIELDS } = require('./taskReadAccess');

// A time log, a plan or an invoice line names its task and its project by id, and stays with the person after they
// can no longer open them. A screen that lists such rows reads the names here: a row whose task or project is not
// among the answer keeps its numbers and is shown without a name.

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const idsOf = (ids) => [...new Set((ids || []).map((id) => String(id || '')))].filter((id) => OBJECT_ID.test(id));
const oid = (id) => new mongoose.Types.ObjectId(id);
const byId = (rows) => Object.fromEntries(rows.map((row) => [String(row._id), row]));

const openTasksById = async (companyId, uid, ids, fields = {}) => {
    const wanted = idsOf(ids);
    if (!wanted.length || !uid) return {};
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ _id: { $in: wanted.map(oid) }, mainChat: { $ne: true } }, { ...fields, ...TASK_READ_FIELDS }],
    }, 'find');
    return byId(await readableTasks(companyId, String(uid), rows || []));
};

const openProjectsById = async (companyId, uid, ids, fields = {}) => {
    const open = [];
    for (const id of idsOf(ids)) {
        if ((await canReadProject(companyId, uid, id)).allowed) open.push(id);
    }
    if (!open.length) return {};
    return byId(await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: { $in: open.map(oid) } }, fields] }, 'find') || []);
};

module.exports = { openTasksById, openProjectsById };

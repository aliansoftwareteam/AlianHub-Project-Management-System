const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { hiddenSprintFilter } = require('../../Sprints/helpers/sprintVisibility');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const distinct = (rows, field) => [...new Set(rows.map((row) => String(row[field] || '')).filter((id) => OBJECT_ID.test(id)))];

/* A plan row names its task and project but no sprint, so a row on a task in a private sprint
 * the viewer is not on is found through the task. */
const withoutHiddenSprintPlans = async (companyId, uid, estimates) => {
    const rows = estimates || [];
    const hidden = ((await hiddenSprintFilter(companyId, uid, distinct(rows, 'ProjectId'))).sprintId || { $nin: [] }).$nin;
    if (!hidden.length) return rows;
    const tasks = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ _id: { $in: distinct(rows, 'TaskId').map((id) => new mongoose.Types.ObjectId(id)) }, sprintId: { $in: hidden } }, { _id: 1 }],
    }, 'find');
    const unseen = new Set((tasks || []).map((task) => String(task._id)));
    return rows.filter((row) => !unseen.has(String(row.TaskId)));
};

module.exports = { withoutHiddenSprintPlans };

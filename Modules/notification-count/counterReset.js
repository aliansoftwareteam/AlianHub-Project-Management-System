const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { canEditProject, DELETE_OR_CLOSE } = require('../../Config/projectAccess');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const COUNTER_KEY = /^(?:project|task)_([a-f0-9]{24})_(?:([a-f0-9]{24})_)?$/i;
const REMOVES_LIST = ['project.sprint_delete', 'project.sprint_archive'];

/* A reset clears the unread counters of everyone in the workspace, so its key names one project
 * (and at most one of its lists) and is never a looser pattern over the counter fields. */
const resetTargetOf = ({ projectId = '', sprintId = '', searchKey } = {}) => {
    if (searchKey !== undefined && searchKey !== null && searchKey !== '') {
        const named = typeof searchKey === 'string' ? COUNTER_KEY.exec(searchKey) : null;
        return named ? { projectId: named[1], sprintId: named[2] || '', searchKey } : null;
    }
    if (typeof projectId !== 'string' || !OBJECT_ID.test(projectId)) return null;
    if (sprintId !== '' && (typeof sprintId !== 'string' || !OBJECT_ID.test(sprintId))) return null;
    return { projectId, sprintId, searchKey: '' };
};

const listIsIn = async (companyId, projectId, sprintId) => Boolean(await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.SPRINTS,
    data: [{ _id: new mongoose.Types.ObjectId(sprintId), projectId: new mongoose.Types.ObjectId(projectId) }, { _id: 1 }],
}, 'findOne'));

const NOT_FOUND = { allowed: false, statusCode: 404 };

const mayReset = async (companyId, uid, target) => {
    const decision = await canEditProject(companyId, uid, target.projectId, [target.sprintId ? REMOVES_LIST : DELETE_OR_CLOSE]);
    if (!decision.allowed || !target.sprintId) return decision;
    return (await listIsIn(companyId, target.projectId, target.sprintId)) ? decision : NOT_FOUND;
};

module.exports = { resetTargetOf, mayReset };

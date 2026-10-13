const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration,validateObjectId } = require("../../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose")

/*
 * The web app sends this route only from the project close, delete, archive and restore flows
 * (ProjectsListingSetting.vue, Item.vue), and only ever moves deletedStatusKey. The filter may carry
 * $in because the delete cascade matches tasks with no key; JSON turns that undefined into null.
 * ProjectsListingSetting.vue sends the update already wrapped in $set; wrapping it again would name a
 * "$set" field that the strict schema drops, so the write would match every task and change none.
 */
const FILTER_FIELDS = ['ProjectID', 'deletedStatusKey'];
const UPDATE_FIELD = 'deletedStatusKey';

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isStatusKey = (value) => Number.isInteger(value);

const filterProblem = (findObject) => {
    if (!isPlainObject(findObject)) return 'findObject must be an object.';
    const unknown = Object.keys(findObject).find((key) => !FILTER_FIELDS.includes(key));
    if (unknown !== undefined) return `findObject may not name "${unknown}".`;
    const status = findObject.deletedStatusKey;
    if (status === undefined || isStatusKey(status)) return null;
    if (!isPlainObject(status)) return 'findObject.deletedStatusKey must be a number.';
    const operator = Object.keys(status).find((key) => key !== '$in');
    if (operator !== undefined) return `findObject.deletedStatusKey may not use "${operator}".`;
    const values = status.$in;
    return Array.isArray(values) && values.every((value) => value === null || isStatusKey(value))
        ? null
        : 'findObject.deletedStatusKey.$in must list numbers.';
};

const updateProblem = (updateObject, { inSet = false } = {}) => {
    if (!isPlainObject(updateObject)) return 'updateObject must be an object.';
    const keys = Object.keys(updateObject);
    if (keys.length !== 1) return keys.length ? `updateObject may only set ${UPDATE_FIELD}, not "${keys.find((key) => key !== UPDATE_FIELD)}".` : `updateObject must set ${UPDATE_FIELD}.`;
    const [key] = keys;
    if (key === '$set' && !inSet) return updateProblem(updateObject.$set, { inSet: true });
    if (key !== UPDATE_FIELD) return `updateObject may only set ${UPDATE_FIELD}, not "${key}".`;
    return isStatusKey(updateObject[key]) ? null : `updateObject.${UPDATE_FIELD} must be a number.`;
};

exports.projectAlltaskUpdate = async (req,res) => {
    try {

        const projectId = req.params.id;

        if (!(req.body && req.body.findObject)) {
            return res.status(400).json({ status: false, statusText: 'find Object is Required' });
        }

        if (!(req.body && req.body.updateObject)) {
            return res.status(400).json({ status: false, statusText: 'Update Object is Required' });
        }

        if (!validateObjectId(projectId)) {
            return res.status(400).json({ status: false, statusText: 'Invalid project ID' });
        }

        const problem = filterProblem(req.body.findObject) || updateProblem(req.body.updateObject);
        if (problem) {
            return res.status(400).json({ status: false, statusText: problem });
        }

        const findProjectId = req.body.findObject.ProjectID;
        if (findProjectId !== undefined && String(findProjectId) !== String(projectId)) {
            return res.status(400).json({ status: false, statusText: 'findObject.ProjectID must match the project in the URL.' });
        }

        let mongoObj = {
            type: SCHEMA_TYPE.TASKS,
            data: [
                {
                    ...req.body.findObject,
                    ProjectID: new mongoose.Types.ObjectId(projectId),
                },
                {$set: req.body.updateObject.$set || req.body.updateObject}
            ]
        }
        const result = await MongoDbCrudOpration(req.headers['companyid'], mongoObj, 'updateMany');

        if (!result || result.acknowledged === false) {
            return res.status(400).json({ status: false, statusText: "Project's task not updated" });
        }

        return res.status(200).json({
            status: true,
            statusText: 'Project tasks updated.',
            data: { matched: result.matchedCount || 0, modified: result.modifiedCount || 0 },
        });
    } catch (error) {
        return res.status(500).json({ status: false, statusText: 'An error occurred while updating the project tasks', message: error.message });
    }
}

const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const socketEmitter = require('../../event/socketEventEmitter');
const { validateEpicInput, validateAssignInput, countDeltas, isObjectIdString, EPIC_STATUSES, EPIC_PRIORITIES, parseEpicDates } = require('./helpers/epicRules');

// Epics: a grouping layer above tasks with progress roll-up. Tasks carry an
// optional epicId; epics keep denormalised taskCount/completedCount which
// the assign flow maintains and /recount can rebuild from scratch.

/* POST /api/v2/epics  body: { name, description?, color?, projectId, userData } */
exports.createEpic = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { name, description, color, projectId, priority, ownerUserId, startDate, dueDate, userData } = req.body || {};
        const check = validateEpicInput({ companyId, name, projectId, color, priority });
        if (!check.valid) {
            return res.send({ status: false, statusText: check.reason });
        }
        const dateCheck = parseEpicDates({ startDate, dueDate });
        if (!dateCheck.valid) {
            return res.send({ status: false, statusText: dateCheck.reason });
        }
        const created = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.EPICS,
            data: {
                name: String(name).trim(),
                description: description ? String(description) : '',
                ProjectID: new mongoose.Types.ObjectId(projectId),
                color: color || '#7b68ee',
                status: 'open',
                priority: priority ? String(priority) : 'medium',
                ownerUserId: ownerUserId ? String(ownerUserId) : '',
                startDate: dateCheck.startDate || null,
                dueDate: dateCheck.dueDate || null,
                createdBy: userData && (userData.id || userData._id) ? String(userData.id || userData._id) : '',
                taskCount: 0,
                completedCount: 0,
                deletedStatusKey: 0,
            },
        }, 'save');
        return res.send({ status: true, statusText: 'Epic created.', data: created });
    } catch (error) {
        logger.error(`ERROR in create epic: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/epics?projectId= */
exports.listEpics = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const projectId = String(req.query?.projectId || '');
        if (!companyId || !isObjectIdString(projectId)) {
            return res.send({ status: false, statusText: 'companyId and a valid projectId are required.' });
        }
        const epics = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.EPICS,
            data: [
                { ProjectID: new mongoose.Types.ObjectId(projectId), deletedStatusKey: 0 },
                null,
                { sort: { createdAt: 1 } },
            ],
        }, 'find');
        return res.send({ status: true, statusText: 'Epics fetched.', data: epics || [] });
    } catch (error) {
        logger.error(`ERROR in list epics: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* PUT /api/v2/epics/:id  body: { name?, color?, status?, description? } */
exports.updateEpic = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { id } = req.params;
        if (!companyId || !isObjectIdString(id)) {
            return res.send({ status: false, statusText: 'companyId and a valid epic id are required.' });
        }
        const { name, color, status, description, priority, ownerUserId, startDate, dueDate } = req.body || {};
        const update = {};
        if (name !== undefined) {
            if (!String(name).trim()) return res.send({ status: false, statusText: 'name cannot be empty.' });
            update.name = String(name).trim();
        }
        if (color !== undefined) update.color = color;
        if (description !== undefined) update.description = String(description);
        if (status !== undefined) {
            if (!EPIC_STATUSES.includes(status)) return res.send({ status: false, statusText: 'Invalid status.' });
            update.status = status;
        }
        if (priority !== undefined) {
            if (priority !== '' && priority !== null && !EPIC_PRIORITIES.includes(String(priority))) {
                return res.send({ status: false, statusText: 'Invalid priority.' });
            }
            update.priority = priority ? String(priority) : '';
        }
        if (ownerUserId !== undefined) update.ownerUserId = ownerUserId ? String(ownerUserId) : '';
        if (startDate !== undefined || dueDate !== undefined) {
            const dateCheck = parseEpicDates({ startDate, dueDate });
            if (!dateCheck.valid) return res.send({ status: false, statusText: dateCheck.reason });
            if (startDate !== undefined) update.startDate = dateCheck.startDate || null;
            if (dueDate !== undefined) update.dueDate = dateCheck.dueDate || null;
        }
        if (!Object.keys(update).length) {
            return res.send({ status: false, statusText: 'Nothing to update.' });
        }
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.EPICS,
            data: [{ _id: new mongoose.Types.ObjectId(id) }, { $set: update }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (!updated) {
            return res.send({ status: false, statusText: 'Epic not found.' });
        }
        return res.send({ status: true, statusText: 'Epic updated.', data: updated });
    } catch (error) {
        logger.error(`ERROR in update epic: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* DELETE /api/v2/epics/:id — soft delete; member tasks keep living, just unlinked. */
exports.deleteEpic = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { id } = req.params;
        if (!companyId || !isObjectIdString(id)) {
            return res.send({ status: false, statusText: 'companyId and a valid epic id are required.' });
        }
        const epicObjId = new mongoose.Types.ObjectId(id);
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ epicId: epicObjId }, { $unset: { epicId: '' } }],
        }, 'updateMany');
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.EPICS,
            data: [{ _id: epicObjId }, { $set: { deletedStatusKey: 1 } }],
        }, 'updateOne');
        return res.send({ status: true, statusText: 'Epic deleted.' });
    } catch (error) {
        logger.error(`ERROR in delete epic: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/epics/assign  body: { taskId, epicId|null, userData } */
exports.assignTask = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { taskId, epicId } = req.body || {};
        const check = validateAssignInput({ companyId, taskId, epicId });
        if (!check.valid) {
            return res.send({ status: false, statusText: check.reason });
        }

        const taskObjId = new mongoose.Types.ObjectId(taskId);
        const task = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ _id: taskObjId, deletedStatusKey: { $ne: 1 } }],
        }, 'findOne');
        if (!task) {
            return res.send({ status: false, statusText: 'Task not found.' });
        }

        const targetEpicId = epicId && String(epicId).length ? String(epicId) : null;
        if (targetEpicId) {
            const epic = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.EPICS,
                data: [{ _id: new mongoose.Types.ObjectId(targetEpicId), deletedStatusKey: 0 }],
            }, 'findOne');
            if (!epic) {
                return res.send({ status: false, statusText: 'Epic not found.' });
            }
        }

        const updateObj = targetEpicId
            ? { $set: { epicId: new mongoose.Types.ObjectId(targetEpicId) } }
            : { $unset: { epicId: '' } };
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ _id: taskObjId }, updateObj, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');

        socketEmitter.emit('update', { type: "update", data: updated, updatedFields: { epicId: updated?.epicId || null }, module: 'task' });

        const deltas = countDeltas({
            oldEpicId: task.epicId,
            newEpicId: targetEpicId,
            isCompleted: task.statusType === 'close',
        });
        for (const delta of deltas) {
            // eslint-disable-next-line no-await-in-loop
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.EPICS,
                data: [{ _id: new mongoose.Types.ObjectId(delta.epicId) }, { $inc: delta.inc }],
            }, 'updateOne').catch((error) => {
                logger.error(`ERROR in epic counter update: ${error.message}`);
            });
        }

        return res.send({ status: true, statusText: targetEpicId ? 'Task added to epic.' : 'Task removed from epic.', data: { taskId, epicId: targetEpicId } });
    } catch (error) {
        logger.error(`ERROR in assign epic: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/epics/:id/recount — rebuild counters from the tasks. */
exports.recountEpic = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { id } = req.params;
        if (!companyId || !isObjectIdString(id)) {
            return res.send({ status: false, statusText: 'companyId and a valid epic id are required.' });
        }
        const epicObjId = new mongoose.Types.ObjectId(id);
        const tasks = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ epicId: epicObjId, deletedStatusKey: { $ne: 1 } }, 'statusType'],
        }, 'find');
        const taskCount = (tasks || []).length;
        const completedCount = (tasks || []).filter((task) => task.statusType === 'close').length;
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.EPICS,
            data: [{ _id: epicObjId }, { $set: { taskCount, completedCount } }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        return res.send({ status: true, statusText: 'Epic counters rebuilt.', data: updated });
    } catch (error) {
        logger.error(`ERROR in recount epic: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

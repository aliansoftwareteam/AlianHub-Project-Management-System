const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const logger = require('../../Config/loggerConfig');
const socketEmitter = require('../../event/socketEventEmitter');

// Per-status work-in-progress limit. Lives on the status entry inside
// project.taskStatusData (`wipLimit`), so it travels with the board columns that
// are already built from that array and needs no second fetch.
//
// The limit is advisory: the board colours the column header when the count
// reaches or passes it and nothing refuses a drop.

const LOG_PREFIX = '[wipLimit]';
const MAX_WIP_LIMIT = 999;

/* null clears the limit, which is why 0 and '' are not stored as numbers — an
 * unset limit has to stay distinguishable from a limit of zero. */
const normaliseLimit = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.min(n, MAX_WIP_LIMIT);
};

const plainStatus = (entry) => (entry && entry.toObject ? entry.toObject() : { ...entry });

/* POST /api/v1/projectSetting/taskStatus/wipLimit
 * body: { projectId, statusKey, wipLimit } */
async function setWipLimit(req, res) {
    try {
        const companyId = req.headers['companyid'] || (req.body && req.body.companyId);
        const { projectId, statusKey } = req.body || {};
        if (!companyId || !projectId || statusKey === undefined || statusKey === null || statusKey === '') {
            return res.send({ status: false, statusText: 'companyId, projectId and statusKey are required.' });
        }
        if (!mongoose.Types.ObjectId.isValid(String(projectId))) {
            return res.send({ status: false, statusText: 'Invalid project id.' });
        }

        const project = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [{ _id: new mongoose.Types.ObjectId(String(projectId)) }, 'taskStatusData'],
        }, 'findOne');
        if (!project) {
            return res.send({ status: false, statusText: 'Project not found.' });
        }

        const statuses = (Array.isArray(project.taskStatusData) ? project.taskStatusData : []).map(plainStatus);
        const index = statuses.findIndex((s) => String(s.key) === String(statusKey));
        if (index === -1) {
            return res.send({ status: false, statusText: 'That status is not on this project.' });
        }

        const limit = normaliseLimit(req.body.wipLimit);
        statuses[index] = { ...statuses[index], wipLimit: limit };

        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [
                { _id: new mongoose.Types.ObjectId(String(projectId)) },
                { $set: { taskStatusData: statuses } },
                { returnDocument: 'after' },
            ],
        }, 'findOneAndUpdate');
        if (!updated) {
            return res.send({ status: false, statusText: 'Project not updated.' });
        }

        removeCache('UserProjectData:', true);
        socketEmitter.emit('update', {
            type: 'update',
            data: updated,
            updatedFields: { taskStatusData: statuses },
            module: 'project',
        });

        return res.send({
            status: true,
            statusText: limit ? `WIP limit set to ${limit}.` : 'WIP limit cleared.',
            data: { statusKey: String(statusKey), wipLimit: limit, taskStatusData: statuses },
        });
    } catch (error) {
        logger.error(`${LOG_PREFIX} set failed: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
}

module.exports = { setWipLimit, normaliseLimit, MAX_WIP_LIMIT };

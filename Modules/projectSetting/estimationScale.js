// Per-project story-point estimation scale (S3-02). Sets project.estimationScale,
// which drives the values the Story Points picker offers. Mirrors the
// autoArchive project-setting pattern (a simple $set on the PROJECTS doc).
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');

const LOG_PREFIX = '[estimationScale]';
const SCALES = ['fibonacci', 'linear', 'tshirt', 'hours'];

/* POST /api/v1/projectSetting/estimationScale  body: { projectId, scale } */
async function setEstimationScale(req, res) {
    try {
        const companyId = req.headers['companyid'] || '';
        const { projectId, scale } = req.body || {};
        if (!companyId || !projectId) {
            return res.send({ status: false, statusText: 'companyId and projectId are required.' });
        }
        const value = SCALES.includes(String(scale)) ? String(scale) : 'fibonacci';
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [
                { _id: new mongoose.Types.ObjectId(projectId) },
                { $set: { estimationScale: value } },
                { returnDocument: 'after' },
            ],
        }, 'findOneAndUpdate');
        if (!updated) {
            return res.send({ status: false, statusText: 'Project not found.' });
        }
        return res.send({ status: true, statusText: `Estimation scale set to ${value}.`, data: { estimationScale: value } });
    } catch (error) {
        logger.error(`${LOG_PREFIX} set failed: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
}

module.exports = { setEstimationScale, SCALES };

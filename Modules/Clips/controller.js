// Clips (COLLAB-04). Only the clip record lives here; the media file is uploaded
// through the storage endpoint and referenced by url. A clip belongs to req.uid:
// user ids in the body or query are ignored.
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { sanitizeClipPayload } = require('./clipsRules');
const logger = require('../../Config/loggerConfig');

const ownerOf = (req) => String(req.uid || '');
const matchedCount = (result) => (result && result.matchedCount !== undefined ? result.matchedCount : (result && result.modifiedCount) || 0);

exports.createClip = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const userId = ownerOf(req);
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and userId are required' });
        }
        const fields = sanitizeClipPayload(req.body);
        if (!fields.url) {
            return res.send({ status: false, statusText: 'url is required' });
        }
        const doc = {
            _id: new mongoose.Types.ObjectId(),
            userId,
            companyId: String(companyId),
            title: fields.title || '',
            url: fields.url,
            mediaType: fields.mediaType || '',
            mimeType: fields.mimeType || '',
            size: fields.size || 0,
            durationSec: fields.durationSec || 0,
            source: fields.source || '',
            deletedStatusKey: 0,
        };
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.CLIPS, data: doc }, 'save');
        res.send({ status: true, statusText: 'Clip created', data: saved });
    } catch (error) {
        logger.error(`[clips] create failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

exports.listMine = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const userId = ownerOf(req);
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and userId are required' });
        }
        const clips = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.CLIPS,
            data: [{ userId, deletedStatusKey: 0 }, null, { sort: { createdAt: -1 } }],
        }, 'find');
        res.send({ status: true, data: clips || [] });
    } catch (error) {
        logger.error(`[clips] list failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

const updateOwnClip = async (req, res, patch, statusText) => {
    const companyId = req.headers['companyid'];
    const id = String(req.params.id || '');
    const userId = ownerOf(req);
    if (!companyId || !userId || !mongoose.Types.ObjectId.isValid(id)) {
        return res.send({ status: false, statusText: 'companyId and a valid clip id are required' });
    }
    const result = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.CLIPS,
        data: [{ _id: new mongoose.Types.ObjectId(id), userId, deletedStatusKey: 0 }, { $set: patch }],
    }, 'updateOne');
    if (!matchedCount(result)) {
        return res.status(404).send({ status: false, statusText: 'Clip not found' });
    }
    return res.send({ status: true, statusText });
};

exports.updateClip = async (req, res) => {
    try {
        const patch = sanitizeClipPayload(req.body);
        if (!Object.keys(patch).length) {
            return res.send({ status: false, statusText: 'Nothing to update' });
        }
        return await updateOwnClip(req, res, patch, 'Updated');
    } catch (error) {
        logger.error(`[clips] update failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

// The storage file is left in place; only the record is soft-deleted.
exports.deleteClip = async (req, res) => {
    try {
        return await updateOwnClip(req, res, { deletedStatusKey: 1 }, 'Deleted');
    } catch (error) {
        logger.error(`[clips] delete failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

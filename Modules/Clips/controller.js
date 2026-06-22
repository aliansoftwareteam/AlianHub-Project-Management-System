// Clips (COLLAB-04) — HTTP handlers. A clip is a first-class, reusable recording
// asset (owned by a user, company-scoped): recorded once, stored once, then
// referenced anywhere (task attachment, comment, share, or just the owner's
// library). This module persists only the clip RECORD — the media FILE itself is
// uploaded by the frontend through the EXISTING storage upload endpoint; we keep
// just its url. All clips are company-scoped (companyId from the request header),
// matching Modules/Notes/controller.js.
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { sanitizeClipPayload } = require('./clipsRules');
const logger = require('../../Config/loggerConfig');

// Resolve the acting user id from the request (auth context first, then header,
// then body) — identical resolution order to Modules/Notes/controller.js.
function resolveUserId(req) {
    const b = req.body || {};
    return (req.user && (req.user.id || req.user._id))
        || req.headers['userid']
        || b.userId
        || (b.userData && b.userData.id)
        || '';
}

// Create a clip record. Body: { title, url, mediaType, mimeType, size,
// durationSec, source }. The media file must already be uploaded (its url is
// required).
exports.createClip = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const userId = resolveUserId(req);
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and userId are required' });
        }
        const fields = sanitizeClipPayload(req.body);
        if (!fields.url) {
            return res.send({ status: false, statusText: 'url is required' });
        }
        const doc = {
            _id: new mongoose.Types.ObjectId(),
            userId: String(userId),
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

// List the caller's own clips for the current company (newest first).
exports.listMine = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const userId = resolveUserId(req);
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and userId are required' });
        }
        const clips = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.CLIPS,
            data: [{ userId: String(userId), deletedStatusKey: 0 }, null, { sort: { createdAt: -1 } }],
        }, 'find');
        res.send({ status: true, data: clips || [] });
    } catch (error) {
        logger.error(`[clips] list failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

// Rename a clip (set title).
exports.updateClip = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const id = req.params.id;
        if (!companyId || !id) {
            return res.send({ status: false, statusText: 'companyId and clip id are required' });
        }
        const patch = sanitizeClipPayload(req.body);
        if (!Object.keys(patch).length) {
            return res.send({ status: false, statusText: 'Nothing to update' });
        }
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.CLIPS,
            data: [{ _id: new mongoose.Types.ObjectId(id) }, { $set: patch }],
        }, 'updateOne');
        res.send({ status: true, statusText: 'Updated' });
    } catch (error) {
        logger.error(`[clips] update failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

// Soft-delete a clip record (the storage file is left untouched in this phase).
exports.deleteClip = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const id = req.params.id;
        if (!companyId || !id) {
            return res.send({ status: false, statusText: 'companyId and clip id are required' });
        }
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.CLIPS,
            data: [{ _id: new mongoose.Types.ObjectId(id) }, { $set: { deletedStatusKey: 1 } }],
        }, 'updateOne');
        res.send({ status: true, statusText: 'Deleted' });
    } catch (error) {
        logger.error(`[clips] delete failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

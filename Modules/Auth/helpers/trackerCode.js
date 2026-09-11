const crypto = require('crypto');
const mongoose = require('mongoose');
const mongoC = require('../../../utils/mongo-handler/mongoQueries');
const { dbCollections } = require('../../../Config/collections');

const TRACKER_CODE_TTL_MS = 2 * 60 * 1000;
const TRACKER_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const sessionsCrud = (data, method) => mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.SESSIONS, data }, method);

const hashTrackerCode = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');

// The code lives on the browser session that asked for it, so signing that session out drops it.
const issueTrackerCode = async ({ userId, sessionId }) => {
    if (!userId || !mongoose.Types.ObjectId.isValid(sessionId)) return null;
    const code = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + TRACKER_CODE_TTL_MS);
    const updated = await sessionsCrud([
        { _id: new mongoose.Types.ObjectId(sessionId), userId: String(userId) },
        { $set: { trackerCodeHash: hashTrackerCode(code), trackerCodeExpiresAt: expiresAt } },
        { new: true },
    ], 'findOneAndUpdate');
    return updated ? { code, expiresAt } : null;
};

const redeemTrackerCode = async (code) => {
    if (typeof code !== 'string' || !TRACKER_CODE_PATTERN.test(code)) return null;
    const session = await sessionsCrud([
        { trackerCodeHash: hashTrackerCode(code), trackerCodeExpiresAt: { $gt: new Date(Date.now()) } },
        { $unset: { trackerCodeHash: '', trackerCodeExpiresAt: '' } },
    ], 'findOneAndUpdate');
    return session && session.userId ? String(session.userId) : null;
};

module.exports = { issueTrackerCode, redeemTrackerCode, TRACKER_CODE_TTL_MS };

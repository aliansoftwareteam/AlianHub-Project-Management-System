const mongoose = require('mongoose');
const mongoC = require('../../../utils/mongo-handler/mongoQueries');
const { dbCollections } = require('../../../Config/collections');
const { myCache } = require('../../../Config/config');
const rules = require('./refreshTokenRules');

const sessionsCrud = (data, method) => mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.SESSIONS, data }, method);

const refusal = (reason, revoked = false) => ({ ok: false, reason, revoked });

const issuedFields = ({ token, jti }) => ({
    refreshTokenHash: rules.hashRefreshToken(token),
    refreshTokenJti: jti,
    tokenTail: rules.tokenTailOf(token),
});

const dropSessionCache = (userId) => {
    const prefix = `session:${userId}:`;
    myCache.keys().filter((key) => key.startsWith(prefix)).forEach((key) => myCache.del(key));
};

const revokeSessions = async (filter, userIds) => {
    await sessionsCrud([filter], 'deleteMany');
    [...new Set(userIds.map(String))].forEach(dropSessionCache);
};

const rotatedMomentsAgo = (session) => Boolean(session.rotatedAt)
    && Date.now() - new Date(session.rotatedAt).getTime() <= rules.reuseGraceSeconds() * 1000;

const refuseStaleToken = async (session, presentedHash) => {
    if (session.previousRefreshTokenHash === presentedHash && rotatedMomentsAgo(session)) return refusal('rotated');
    await revokeSessions({ _id: session._id }, [session.userId]);
    return refusal('reused', true);
};

const newSessionCredentials = (userId) => {
    const sessionId = new mongoose.Types.ObjectId();
    const issued = rules.signRefreshToken({ userId, sessionId });
    return { refreshToken: issued.token, fields: { _id: sessionId, ...issuedFields(issued) } };
};

const resolveCurrentToken = async (token, payload, hash) => {
    if (!mongoose.Types.ObjectId.isValid(payload.sid)) return refusal('invalid');
    const session = await sessionsCrud([{ _id: new mongoose.Types.ObjectId(payload.sid), userId: payload.sub }], 'findOne');
    if (!session) return refusal('unknown');
    if (session.refreshTokenHash !== hash || session.refreshTokenJti !== payload.jti) return refuseStaleToken(session, hash);
    return { ok: true, legacy: false, session, token, payload, hash };
};

// Legacy tokens name no user, and two issued in the same second are identical,
// so one is honoured only while exactly one session holds it and that session
// belongs to the caller. A shared token is treated as compromised.
const resolveLegacyToken = async (token, payload, hash, claimedUserId) => {
    if (!claimedUserId) return refusal('userRequired');
    const holders = await sessionsCrud([{ refreshToken: token }], 'find');
    if (holders.length > 1) {
        await revokeSessions({ refreshToken: token }, holders.map((holder) => holder.userId));
        return refusal('ambiguous', true);
    }
    if (holders.length === 1) {
        if (String(holders[0].userId) !== String(claimedUserId)) return refusal('mismatch');
        return { ok: true, legacy: true, session: holders[0], token, payload, hash };
    }
    const rotated = await sessionsCrud([{ userId: String(claimedUserId), previousRefreshTokenHash: hash }], 'findOne');
    if (!rotated) return refusal('unknown');
    return refuseStaleToken(rotated, hash);
};

const resolveRefreshSession = async (token, claimedUserId) => {
    const read = rules.readRefreshToken(token);
    if (!read.valid) return refusal(read.reason);
    const hash = rules.hashRefreshToken(token);
    return read.legacy
        ? resolveLegacyToken(token, read.payload, hash, claimedUserId)
        : resolveCurrentToken(token, read.payload, hash);
};

const rotateRefreshSession = async ({ session, legacy, token, payload, hash }) => {
    const issued = rules.signRefreshToken({ userId: session.userId, sessionId: session._id, expiresAt: payload.exp });
    const filter = legacy ? { _id: session._id, refreshToken: token } : { _id: session._id, refreshTokenHash: hash };
    const update = { $set: { ...issuedFields(issued), previousRefreshTokenHash: hash, rotatedAt: new Date(Date.now()) } };
    if (legacy) update.$unset = { refreshToken: '' };
    const updated = await sessionsCrud([filter, update, { new: true }], 'findOneAndUpdate');
    if (!updated) return refusal('rotated');
    myCache.del(`session:${session.userId}:${token}`);
    return { ok: true, userId: String(session.userId), refreshToken: issued.token, expiresAt: issued.exp };
};

module.exports = {
    newSessionCredentials,
    resolveRefreshSession,
    rotateRefreshSession,
};

const crypto = require('crypto');
const mongoose = require('mongoose');
const mongoC = require('../../../utils/mongo-handler/mongoQueries');
const { dbCollections } = require('../../../Config/collections');

const TRACKER_CODE_TTL_MS = 2 * 60 * 1000;
const TRACKER_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const SPENT_AT = new Date(0);

const sessionsCrud = (data, method) => mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.SESSIONS, data }, method);

const hashTrackerCode = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');

const isCodeChallenge = (value) => typeof value === 'string' && CODE_CHALLENGE_PATTERN.test(value);

const challengeOf = (verifier) => crypto.createHash('sha256').update(String(verifier)).digest('base64url');

const sameSecret = (left, right) => {
    const a = Buffer.from(String(left));
    const b = Buffer.from(String(right));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Tracker builds released before PKCE open the browser without a challenge and redeem without a
// verifier. Unset keeps them working; set an ISO date to refuse them from then on. An unparseable
// value reads as unset, so a typo cannot lock every desktop tracker out.
const legacyTrackerAllowed = () => {
    const until = Date.parse(String(process.env.TRACKER_PKCE_LEGACY_UNTIL || '').trim());
    return Number.isFinite(until) ? Date.now() < until : true;
};

// The code lives on the browser session that asked for it, so signing that session out drops it.
const issueTrackerCode = async ({ userId, sessionId, codeChallenge }) => {
    if (!userId || !mongoose.Types.ObjectId.isValid(sessionId)) return null;
    const code = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + TRACKER_CODE_TTL_MS);
    const set = { trackerCodeHash: hashTrackerCode(code), trackerCodeExpiresAt: expiresAt };
    const update = isCodeChallenge(codeChallenge)
        ? { $set: { ...set, trackerCodeChallenge: codeChallenge } }
        : { $set: set, $unset: { trackerCodeChallenge: '' } };
    const updated = await sessionsCrud([
        { _id: new mongoose.Types.ObjectId(sessionId), userId: String(userId) },
        update,
        { new: true },
    ], 'findOneAndUpdate');
    return updated ? { code, expiresAt } : null;
};

// Spending the code and checking the verifier are separate steps on purpose: the atomic update
// below spends the code whatever the verifier turns out to be, so a wrong verifier cannot be
// retried against the same code. The challenge is only cleared afterwards, because a
// findOneAndUpdate returns the document before the update on Mongo and after it in the test double.
const redeemTrackerCode = async (code, codeVerifier) => {
    if (typeof code !== 'string' || !TRACKER_CODE_PATTERN.test(code)) return { ok: false, reason: 'code' };
    const session = await sessionsCrud([
        { trackerCodeHash: hashTrackerCode(code), trackerCodeExpiresAt: { $gt: new Date(Date.now()) } },
        { $set: { trackerCodeExpiresAt: SPENT_AT } },
    ], 'findOneAndUpdate');
    if (!(session && session.userId)) return { ok: false, reason: 'code' };

    const { trackerCodeChallenge: challenge } = session;
    await sessionsCrud([
        { _id: session._id },
        { $unset: { trackerCodeHash: '', trackerCodeExpiresAt: '', trackerCodeChallenge: '' } },
    ], 'updateOne');

    if (!challenge) {
        return legacyTrackerAllowed() ? { ok: true, userId: String(session.userId) } : { ok: false, reason: 'legacy' };
    }
    if (typeof codeVerifier !== 'string' || !CODE_VERIFIER_PATTERN.test(codeVerifier)) return { ok: false, reason: 'verifier' };
    if (!sameSecret(challengeOf(codeVerifier), challenge)) return { ok: false, reason: 'verifier' };
    return { ok: true, userId: String(session.userId) };
};

module.exports = { issueTrackerCode, redeemTrackerCode, isCodeChallenge, challengeOf, TRACKER_CODE_TTL_MS };

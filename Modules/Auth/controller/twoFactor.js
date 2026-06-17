// Two-factor auth (TOTP) — Phase 1 controller. Opt-in, password-login only.
// Endpoints:
//   POST /api/v2/auth/2fa/setup    (authed) → otpauth URL + QR, stores a PENDING secret
//   POST /api/v2/auth/2fa/verify   (authed) { code } → enable + return recovery codes once
//   POST /api/v2/auth/2fa/disable  (authed) { code } → clear 2FA (needs a valid TOTP/recovery code)
//   POST /api/v2/auth/2fa/validate (public) { tempToken, code } → exchange for a real session
// The secret is AES-encrypted at rest; recovery codes are bcrypt-hashed and
// single-use. Nothing secret is ever returned to the client except the one-time
// manual-entry key (setup) and the one-time recovery codes (verify).
const mongoose = require('mongoose');
const QRCode = require('qrcode');
const mongoC = require('../../../utils/mongo-handler/mongoQueries');
const { dbCollections } = require('../../../Config/collections');
const logger = require('../../../Config/loggerConfig');
const rules = require('../helpers/twoFactorRules');
const loginSessionCtrl = require('./loginSession');

// ── DB helpers (userAuth lives in the global DB, keyed by _id) ───────────
const findUserAuthById = (uid) => mongoC.MongoDbCrudOpration(
    dbCollections.GLOBAL,
    { type: dbCollections.USER_AUTH, data: [{ _id: new mongoose.Types.ObjectId(uid) }] },
    'findOne',
);
// twoFactor is a Mixed object — write it wholesale to avoid partial-update pitfalls.
const setTwoFactor = (uid, twoFactor) => mongoC.MongoDbCrudOpration(
    dbCollections.GLOBAL,
    { type: dbCollections.USER_AUTH, data: [{ _id: new mongoose.Types.ObjectId(uid) }, { $set: { twoFactor } }] },
    'updateOne',
);

// Index of the first matching (still-unused) recovery code, or -1.
const findRecoveryMatch = async (code, hashes) => {
    if (!code || !Array.isArray(hashes)) return -1;
    for (let i = 0; i < hashes.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        if (await rules.verifyRecoveryCode(code, hashes[i])) return i;
    }
    return -1;
};

// GET /api/v2/auth/2fa/status (authed) — is 2FA enabled for the logged-in user?
exports.twoFaStatus = async (req, res) => {
    try {
        const user = await findUserAuthById(req.uid);
        return res.status(200).json({ status: true, data: { enabled: !!(user && user.twoFactor && user.twoFactor.enabled) } });
    } catch (error) {
        logger.error(`2FA status error: ${error?.message || error}`);
        return res.status(400).json({ status: false, message: error?.message || 'Failed to read 2FA status' });
    }
};

// POST /api/v2/auth/2fa/setup (authed) — start enrollment.
exports.twoFaSetup = async (req, res) => {
    try {
        const uid = req.uid;
        const user = await findUserAuthById(uid);
        if (!user?._id) return res.status(404).json({ status: false, message: 'User not found' });
        if (user.twoFactor && user.twoFactor.enabled) {
            return res.status(409).json({ status: false, message: 'Two-factor authentication is already enabled. Disable it first to re-enroll.' });
        }
        const secret = rules.generateSecret();
        const otpauthUrl = rules.keyuri(user.email, secret);
        const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
        await setTwoFactor(uid, { ...(user.twoFactor || {}), enabled: false, pendingSecretEnc: rules.encryptSecret(secret) });
        return res.status(200).json({
            status: true,
            statusText: 'Scan the QR code or enter the key in your authenticator app.',
            data: { otpauthUrl, qrDataUrl, secret }, // `secret` = manual-entry key, shown once
        });
    } catch (error) {
        logger.error(`2FA setup error: ${error?.message || error}`);
        return res.status(400).json({ status: false, message: error?.message || 'Failed to start 2FA setup' });
    }
};

// POST /api/v2/auth/2fa/verify (authed) { code } — confirm a code, enable, return recovery codes.
exports.twoFaVerify = async (req, res) => {
    try {
        const uid = req.uid;
        const code = req.body?.code;
        const user = await findUserAuthById(uid);
        if (!user?._id) return res.status(404).json({ status: false, message: 'User not found' });
        const pending = user.twoFactor && user.twoFactor.pendingSecretEnc;
        if (!pending) return res.status(400).json({ status: false, message: 'Start 2FA setup first.' });
        const secret = rules.decryptSecret(pending);
        if (!secret || !rules.verifyTotp(code, secret)) {
            return res.status(400).json({ status: false, message: 'That code is not valid. Check your authenticator app and try again.' });
        }
        const recoveryCodes = rules.generateRecoveryCodes();
        const hashed = await Promise.all(recoveryCodes.map((c) => rules.hashRecoveryCode(c)));
        await setTwoFactor(uid, { enabled: true, secretEnc: pending, recoveryCodes: hashed, enrolledAt: new Date() });
        return res.status(200).json({
            status: true,
            statusText: 'Two-factor authentication is now enabled. Save these recovery codes — they are shown only once.',
            data: { recoveryCodes },
        });
    } catch (error) {
        logger.error(`2FA verify error: ${error?.message || error}`);
        return res.status(400).json({ status: false, message: error?.message || 'Failed to enable 2FA' });
    }
};

// POST /api/v2/auth/2fa/disable (authed) { code } — needs a current TOTP or a recovery code.
exports.twoFaDisable = async (req, res) => {
    try {
        const uid = req.uid;
        const code = req.body?.code;
        const user = await findUserAuthById(uid);
        if (!user?._id) return res.status(404).json({ status: false, message: 'User not found' });
        if (!(user.twoFactor && user.twoFactor.enabled)) {
            return res.status(400).json({ status: false, message: 'Two-factor authentication is not enabled.' });
        }
        const secret = rules.decryptSecret(user.twoFactor.secretEnc);
        let ok = !!secret && rules.verifyTotp(code, secret);
        if (!ok) ok = (await findRecoveryMatch(code, user.twoFactor.recoveryCodes)) !== -1;
        if (!ok) {
            return res.status(400).json({ status: false, message: 'That code is not valid. Enter a current code or a recovery code to disable 2FA.' });
        }
        await setTwoFactor(uid, { enabled: false });
        return res.status(200).json({ status: true, statusText: 'Two-factor authentication has been disabled.' });
    } catch (error) {
        logger.error(`2FA disable error: ${error?.message || error}`);
        return res.status(400).json({ status: false, message: error?.message || 'Failed to disable 2FA' });
    }
};

// POST /api/v2/auth/2fa/validate (PUBLIC) { tempToken, code } — login second-step.
// On failure: set req.errorMessageObject + next() so the route's manageAttempt
// handler rate-limits the attempt by IP (same as password login).
exports.twoFaValidate = async (req, res, next) => {
    try {
        const { tempToken, code } = req.body || {};
        const payload = tempToken ? rules.verifyTempToken(tempToken) : null;
        if (!payload) {
            req.errorMessageObject = { message: 'Your verification session has expired. Please sign in again.' };
            return next();
        }
        const user = await findUserAuthById(payload.uid);
        if (!user?._id || !(user.twoFactor && user.twoFactor.enabled)) {
            req.errorMessageObject = { message: 'Two-factor authentication is not enabled for this account.' };
            return next();
        }
        const secret = rules.decryptSecret(user.twoFactor.secretEnc);
        let ok = !!secret && rules.verifyTotp(code, secret);
        if (!ok) {
            const idx = await findRecoveryMatch(code, user.twoFactor.recoveryCodes);
            if (idx !== -1) {
                ok = true;
                // Recovery codes are single-use — remove the one that matched.
                const remaining = user.twoFactor.recoveryCodes.slice();
                remaining.splice(idx, 1);
                await setTwoFactor(payload.uid, { ...user.twoFactor, recoveryCodes: remaining });
            }
        }
        if (!ok) {
            req.errorMessageObject = { message: 'That code is not valid. Try again or use a recovery code.' };
            return next();
        }
        // Identical session issuance to a normal password login.
        return loginSessionCtrl.finalizeSession(req, res, payload.uid, next);
    } catch (error) {
        logger.error(`2FA validate error: ${error?.message || error}`);
        req.errorMessageObject = { message: error?.message || 'Verification failed' };
        return next();
    }
};

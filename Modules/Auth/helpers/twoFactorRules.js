// Pure / self-contained 2FA (TOTP) helpers. No app or DB imports, so the jest
// suite (tests/twofactor-rules.test.js) can require this file directly without
// pulling in legacy CommonJS that breaks Babel parsing. Only external libs
// (otplib, bcrypt, jsonwebtoken) and Node's crypto are used here.
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');

// TOTP: allow +/-1 step (~30s either side) for clock skew — standard for
// authenticator apps. Set on the shared singleton at load.
authenticator.options = { window: 1 };

const ISSUER = () => process.env.TWO_FACTOR_ISSUER || 'AlianHub';

// ── TOTP secret ─────────────────────────────────────────────────────────
const generateSecret = () => authenticator.generateSecret(); // base32
const keyuri = (accountName, secret) => authenticator.keyuri(accountName || 'user', ISSUER(), secret);
const generateTotp = (secret) => authenticator.generate(secret); // helper for tests/enrollment QA
const isValidTotpFormat = (code) => /^\d{6}$/.test(String(code || '').trim());
const verifyTotp = (code, secret) => {
    if (!secret || !isValidTotpFormat(code)) return false;
    try {
        return authenticator.verify({ token: String(code).trim(), secret });
    } catch (e) {
        return false;
    }
};

// ── Recovery codes ──────────────────────────────────────────────────────
// Single-use backup codes, shown once at enrollment, stored bcrypt-hashed.
// Display format "xxxxx-xxxxx"; compared after normalising (strip non
// alphanumerics, lowercase) so the user can type it with or without the dash.
const RECOVERY_COUNT = 10;
const generateRecoveryCodes = (count = RECOVERY_COUNT) => {
    const codes = [];
    for (let i = 0; i < count; i += 1) {
        const raw = crypto.randomBytes(5).toString('hex'); // 10 hex chars
        codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
    }
    return codes;
};
const normalizeRecoveryCode = (code) => String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const hashRecoveryCode = (code) => bcrypt.hash(normalizeRecoveryCode(code), 10);
const verifyRecoveryCode = (code, hash) => {
    if (!code || !hash) return Promise.resolve(false);
    return bcrypt.compare(normalizeRecoveryCode(code), hash);
};

// ── Secret encryption at rest (AES-256-GCM) ─────────────────────────────
// Key derived from a dedicated env (preferred) or JWT_SECRET (fallback). The
// constant salt is fine here: the KDF input (the env secret) IS the secret.
const getEncKey = () => {
    const material = process.env.TWO_FACTOR_ENC_KEY || process.env.JWT_SECRET || '';
    return crypto.scryptSync(material, 'alianhub-2fa-enc', 32);
};
const encryptSecret = (plain, key = getEncKey()) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
};
const decryptSecret = (payload, key = getEncKey()) => {
    const [ivB64, tagB64, dataB64] = String(payload || '').split(':');
    if (!ivB64 || !tagB64 || !dataB64) return null;
    try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
        decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
        const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
        return dec.toString('utf8');
    } catch (e) {
        return null; // tampered payload / wrong key — fail closed
    }
};

// ── tempToken (login second-step) ───────────────────────────────────────
// Signed with a SEPARATE secret + a twoFactorPending claim, short-lived. The
// normal access-token middleware verifies against JWT_SECRET, so it can never
// accept this token — it is only honoured at /api/v2/auth/2fa/validate.
const tempTokenSecret = () => process.env.TWO_FACTOR_TEMP_SECRET || `${process.env.JWT_SECRET || ''}::2fa-temp`;
const issueTempToken = (uid, secret = tempTokenSecret(), expiresIn = '5m') =>
    jwt.sign({ uid: String(uid), twoFactorPending: true }, secret, { algorithm: 'HS256', expiresIn });
const verifyTempToken = (token, secret = tempTokenSecret()) => {
    try {
        const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
        if (!decoded || decoded.twoFactorPending !== true || !decoded.uid) return null;
        return { uid: decoded.uid };
    } catch (e) {
        return null;
    }
};

module.exports = {
    generateSecret,
    keyuri,
    generateTotp,
    isValidTotpFormat,
    verifyTotp,
    RECOVERY_COUNT,
    generateRecoveryCodes,
    normalizeRecoveryCode,
    hashRecoveryCode,
    verifyRecoveryCode,
    getEncKey,
    encryptSecret,
    decryptSecret,
    tempTokenSecret,
    issueTempToken,
    verifyTempToken,
};

// AHE-3838 — token encryption at rest. Same construction as
// Modules/Auth/helpers/twoFactorRules.js (AES-256-GCM, key from a dedicated env
// with a JWT_SECRET fallback) so there is one encryption idiom in the codebase
// rather than two.
//
// What is protected: OAuth refresh tokens. A leaked refresh token is long-lived
// access to a user's Drive, so it must never sit in Mongo as plaintext and must
// never be sent to the browser.
const crypto = require('crypto');

const getEncKey = () => {
    const material = process.env.CLOUD_STORAGE_ENC_KEY || process.env.JWT_SECRET || '';
    // Constant salt is fine: the KDF input (the env secret) IS the secret.
    return crypto.scryptSync(material, 'alianhub-cloud-storage-enc', 32);
};

const encryptToken = (plain, key = getEncKey()) => {
    if (plain === null || plain === undefined || String(plain) === '') return '';
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
};

const decryptToken = (payload, key = getEncKey()) => {
    const [ivB64, tagB64, dataB64] = String(payload || '').split(':');
    if (!ivB64 || !tagB64 || !dataB64) return null;
    try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
        decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
        const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
        return dec.toString('utf8');
    } catch (e) {
        return null; // tampered ciphertext or rotated key — fail closed
    }
};

module.exports = { encryptToken, decryptToken, getEncKey };

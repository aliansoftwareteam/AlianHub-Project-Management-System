/* Secrets at rest for any per-company integration credential: AES-256-GCM, wrapped in a versioned marker so a
 * stored value can be told apart from plaintext without guessing: plaintext never starts with "enc:v1:". */
const crypto = require('crypto');

const VERSION = 1;
const PREFIX = `enc:v${VERSION}:`;

// The env name and salt come from the cloud-storage module this began in; changing either would make every stored value unreadable.
const getEncKey = () => crypto.scryptSync(process.env.CLOUD_STORAGE_ENC_KEY || process.env.JWT_SECRET || '', 'alianhub-cloud-storage-enc', 32);

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
        return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
    } catch (e) {
        return null;
    }
};

const isEncrypted = (value) => typeof value === 'string' && value.startsWith(PREFIX);

const encrypt = (value) => {
    if (value === null || value === undefined || String(value) === '') return '';
    if (isEncrypted(value)) return value;
    return PREFIX + encryptToken(String(value));
};

/* Plaintext reads through so unmigrated rows keep working; a value that carries
 * the marker but will not decrypt (tampered, or the key rotated) yields null. */
const decrypt = (value) => (isEncrypted(value) ? decryptToken(value.slice(PREFIX.length)) : value);

const mapFields = (obj, keys, fn) => {
    const out = { ...(obj || {}) };
    for (const key of keys || []) if (out[key] !== undefined && out[key] !== null && out[key] !== '') out[key] = fn(out[key]);
    return out;
};

const sealFields = (obj, keys) => mapFields(obj, keys, encrypt);
const openFields = (obj, keys) => mapFields(obj, keys, decrypt);

module.exports = { VERSION, PREFIX, isEncrypted, encrypt, decrypt, sealFields, openFields };

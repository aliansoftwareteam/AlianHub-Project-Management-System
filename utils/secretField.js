/* Secrets at rest for any per-company integration credential. Same AES-256-GCM
 * construction and key as the cloud-storage tokens (Modules/CloudStorage/helpers/
 * cloudCrypto), wrapped in a versioned marker so a stored value can be told apart
 * from plaintext without guessing: plaintext never starts with "enc:v1:". */
const { encryptToken, decryptToken } = require('../Modules/CloudStorage/helpers/cloudCrypto');

const VERSION = 1;
const PREFIX = `enc:v${VERSION}:`;

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

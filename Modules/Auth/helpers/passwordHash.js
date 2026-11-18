const bcrypt = require('bcrypt');
const crypto = require('crypto');

// Stored beside every hash. Missing means the hash was made before this format and is
// checked the old way until the next successful sign-in stores it again in this one.
const PASSWORD_HASH_VERSION = 2;
const BCRYPT_COST = 10;

// bcrypt gets a fixed-length digest, so every character of a long password counts. Base64,
// not the raw digest: bcrypt stops at a NUL byte, and a raw digest can contain one.
const preHash = (input) => crypto.createHash('sha256').update(String(input), 'utf8').digest('base64');

const hashPassword = async (input) => ({
    passwordHash: await bcrypt.hash(preHash(input), BCRYPT_COST),
    passwordHashVersion: PASSWORD_HASH_VERSION,
});

const isCurrentPasswordHash = (account) => Boolean(account) && account.passwordHashVersion === PASSWORD_HASH_VERSION;

const verifyPassword = (input, account) => (isCurrentPasswordHash(account)
    ? bcrypt.compare(preHash(input), account.passwordHash)
    : bcrypt.compare(input, account.passwordHash));

module.exports = { PASSWORD_HASH_VERSION, hashPassword, isCurrentPasswordHash, verifyPassword };

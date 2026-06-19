// Public-share rules. Pure (crypto only) — shared by controller, the public
// renderer and tests.

const crypto = require('crypto');

const ENTITY_TYPES = Object.freeze(['sprint']);
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
// Accept legacy 16-byte (32-hex) tokens and new 32-byte (64-hex) tokens.
const TOKEN_PATTERN = /^[0-9a-f]{32,64}$/;
const MAX_TITLE_LENGTH = 200;
const MAX_TEXT_LENGTH = 5000;
const MAX_NAME_LENGTH = 120;

const isObjectIdString = (id) => OBJECT_ID_PATTERN.test(String(id || ''));

const generateShareToken = () => crypto.randomBytes(32).toString('hex');

const isShareToken = (token) => TOKEN_PATTERN.test(String(token || ''));

/* Validate share creation. Returns { valid, reason }. */
const validateCreateShare = ({ companyId, entityType, entityId }) => {
    if (!companyId) {
        return { valid: false, reason: 'companyId is required.' };
    }
    if (!ENTITY_TYPES.includes(entityType)) {
        return { valid: false, reason: `entityType must be one of: ${ENTITY_TYPES.join(', ')}.` };
    }
    if (!isObjectIdString(entityId)) {
        return { valid: false, reason: 'A valid entityId is required.' };
    }
    return { valid: true, reason: '' };
};

/* Validate a public intake submission. Returns { valid, reason }. */
const validateIntakeSubmission = ({ title, name, email, description }) => {
    if (!title || !String(title).trim() || String(title).length > MAX_TITLE_LENGTH) {
        return { valid: false, reason: `A title up to ${MAX_TITLE_LENGTH} characters is required.` };
    }
    if (name !== undefined && String(name).length > MAX_NAME_LENGTH) {
        return { valid: false, reason: 'Name is too long.' };
    }
    if (email !== undefined && String(email).length > MAX_NAME_LENGTH) {
        return { valid: false, reason: 'Email is too long.' };
    }
    if (description !== undefined && String(description).length > MAX_TEXT_LENGTH) {
        return { valid: false, reason: 'Description is too long.' };
    }
    return { valid: true, reason: '' };
};

/* HTML-escape for the server-rendered public page. */
const escapeHtml = (text) => String(text === null || text === undefined ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

module.exports = {
    ENTITY_TYPES,
    MAX_TITLE_LENGTH,
    isObjectIdString,
    generateShareToken,
    isShareToken,
    validateCreateShare,
    validateIntakeSubmission,
    escapeHtml,
};

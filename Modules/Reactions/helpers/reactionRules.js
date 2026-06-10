// Emoji reaction rules. Pure data + validation — no I/O — shared by the
// controller, the frontend allowlist, and the unit tests.

// Fixed GitHub-style reaction set. Free-form emoji input is deliberately
// rejected: an allowlist validates cheaply, renders consistently across
// platforms, and keeps junk strings out of the documents.
const REACTION_EMOJIS = Object.freeze(['👍', '❤️', '😄', '🎉', '😮', '😢', '🚀', '👀']);

const TARGET_TYPES = Object.freeze(['task', 'comment']);

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

const isObjectIdString = (id) => OBJECT_ID_PATTERN.test(String(id || ''));

/* Validate a toggle-reaction request. Returns { valid, reason }. */
const validateReactionInput = ({ companyId, targetType, targetId, emoji, userId }) => {
    if (!companyId) {
        return { valid: false, reason: 'companyId is required.' };
    }
    if (!TARGET_TYPES.includes(targetType)) {
        return { valid: false, reason: `targetType must be one of: ${TARGET_TYPES.join(', ')}.` };
    }
    if (!isObjectIdString(targetId)) {
        return { valid: false, reason: 'A valid targetId is required.' };
    }
    if (!REACTION_EMOJIS.includes(emoji)) {
        return { valid: false, reason: 'Unsupported reaction emoji.' };
    }
    if (!userId) {
        return { valid: false, reason: 'userId is required.' };
    }
    return { valid: true, reason: '' };
};

module.exports = {
    REACTION_EMOJIS,
    TARGET_TYPES,
    isObjectIdString,
    validateReactionInput,
};

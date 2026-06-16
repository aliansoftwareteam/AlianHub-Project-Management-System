// Pure validation/normalization rules for sticky notes — NO I/O, so the
// jest suite can import this file directly without dragging in mongoose,
// controllers, or any module that trips the Babel parser on legacy files.

const STICKY_COLORS = ['yellow', 'green', 'blue', 'pink', 'orange', 'purple', 'gray'];
const DEFAULT_COLOR = 'yellow';
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 2000;
const MAX_NOTES_PER_USER = 200;
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

const isObjectId = (value) => OBJECT_ID_PATTERN.test(String(value || ''));

// Notes are plain text rendered as text (never HTML) on the client, so we
// only bound the length and coerce to a string here — no markup stripping.
const normalizeContent = (content) => String(content == null ? '' : content);

const normalizeColor = (color) => (STICKY_COLORS.includes(String(color)) ? String(color) : DEFAULT_COLOR);

// Validate a create/update payload. `partial: true` (update) only checks the
// fields that are present; create requires the note to be within limits.
const validateStickyPayload = (payload = {}, { partial = false } = {}) => {
    const out = {};

    if (!partial || payload.title !== undefined) {
        const title = normalizeContent(payload.title);
        if (title.length > MAX_TITLE_LENGTH) {
            return { valid: false, reason: `Title exceeds ${MAX_TITLE_LENGTH} characters.` };
        }
        out.title = title;
    }

    if (!partial || payload.content !== undefined) {
        const content = normalizeContent(payload.content);
        if (content.length > MAX_CONTENT_LENGTH) {
            return { valid: false, reason: `Content exceeds ${MAX_CONTENT_LENGTH} characters.` };
        }
        out.content = content;
    }

    if (!partial || payload.color !== undefined) {
        out.color = normalizeColor(payload.color);
    }

    if (payload.isPinned !== undefined) {
        // Strict boolean — the string "false" must not coerce to true.
        out.isPinned = payload.isPinned === true || payload.isPinned === 'true' || payload.isPinned === 1 || payload.isPinned === '1';
    }

    if (payload.sortIndex !== undefined) {
        const n = Number(payload.sortIndex);
        if (!Number.isFinite(n)) {
            return { valid: false, reason: 'sortIndex must be a number.' };
        }
        out.sortIndex = n;
    }

    if (partial && Object.keys(out).length === 0) {
        return { valid: false, reason: 'No valid fields to update.' };
    }

    return { valid: true, data: out };
};

// Validate a reorder request: an array of sticky ids in their new order.
const validateReorder = (ids) => {
    if (!Array.isArray(ids) || !ids.length) {
        return { valid: false, reason: 'ids must be a non-empty array.' };
    }
    if (ids.length > MAX_NOTES_PER_USER) {
        return { valid: false, reason: 'Too many ids.' };
    }
    if (!ids.every(isObjectId)) {
        return { valid: false, reason: 'Every id must be a valid ObjectId.' };
    }
    return { valid: true, ids: ids.map(String) };
};

module.exports = {
    STICKY_COLORS,
    DEFAULT_COLOR,
    MAX_TITLE_LENGTH,
    MAX_CONTENT_LENGTH,
    MAX_NOTES_PER_USER,
    isObjectId,
    normalizeContent,
    normalizeColor,
    validateStickyPayload,
    validateReorder,
};

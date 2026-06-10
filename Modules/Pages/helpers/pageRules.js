// Wiki-page rules. Pure — no I/O — shared by controller and tests.

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_BYTES = 512 * 1024; // generous guard for one page body

const isObjectIdString = (id) => OBJECT_ID_PATTERN.test(String(id || ''));

/* Validate create/update input. Returns { valid, reason }. */
const validatePageInput = ({ companyId, title, projectId }) => {
    if (!companyId) {
        return { valid: false, reason: 'companyId is required.' };
    }
    if (!title || !String(title).trim() || String(title).length > MAX_TITLE_LENGTH) {
        return { valid: false, reason: `A title up to ${MAX_TITLE_LENGTH} characters is required.` };
    }
    if (projectId !== undefined && projectId !== null && projectId !== '' && !isObjectIdString(projectId)) {
        return { valid: false, reason: 'projectId must be a valid id when provided.' };
    }
    return { valid: true, reason: '' };
};

/* Guard against absurd payloads before they hit the database. */
const contentTooLarge = (content) => {
    try {
        return Buffer.byteLength(JSON.stringify(content || {}), 'utf8') > MAX_CONTENT_BYTES;
    } catch (e) {
        return true;
    }
};

/* Plain-text body for search/preview: strip tags, collapse whitespace. */
const htmlToRawText = (html, max = 5000) => String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

module.exports = {
    MAX_TITLE_LENGTH,
    MAX_CONTENT_BYTES,
    isObjectIdString,
    validatePageInput,
    contentTooLarge,
    htmlToRawText,
};

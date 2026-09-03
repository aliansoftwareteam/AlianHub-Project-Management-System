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

const REVIEW_INTERVAL_MONTHS = 3;
const STALE_AFTER_MONTHS = 6;
const REVIEW_STATES = ['none', 'verified', 'due', 'stale'];

const addMonths = (date, months) => {
    const next = new Date(date);
    next.setMonth(next.getMonth() + months);
    return next;
};

const parseDate = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const nextReviewDate = (from = new Date(), months = REVIEW_INTERVAL_MONTHS) => addMonths(from, months);

/* 'none' for plain docs. A wiki page is 'verified' until its review date, 'due' after
 * it, and 'stale' once it has gone unreviewed for the full stale window. */
const reviewState = (page, now = new Date()) => {
    if (!page || !page.isWiki) return 'none';
    const due = parseDate(page.reviewDate);
    if (!due) return page.reviewedAt ? 'verified' : 'due';
    if (due > now) return 'verified';
    const staleAt = addMonths(due, STALE_AFTER_MONTHS - REVIEW_INTERVAL_MONTHS);
    return now >= staleAt ? 'stale' : 'due';
};

module.exports = {
    MAX_TITLE_LENGTH,
    MAX_CONTENT_BYTES,
    REVIEW_INTERVAL_MONTHS,
    STALE_AFTER_MONTHS,
    REVIEW_STATES,
    isObjectIdString,
    validatePageInput,
    contentTooLarge,
    htmlToRawText,
    parseDate,
    nextReviewDate,
    reviewState,
};

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

/* A private page belongs to its author alone. Every read path — list, get,
 * Ask retrieval, MCP — applies this one rule so a private doc never leaks by
 * title or body to anyone else in the project. */
const pageVisibleTo = (page, uid) => Boolean(page)
    && (String(page.visibility || '') !== 'private' || String(page.createdBy || '') === String(uid || ''));

const pageVisibilityFilter = (uid) => ({ $or: [{ visibility: { $ne: 'private' } }, { createdBy: String(uid || '') }] });

const inReachableProjects = ({ projectIds, everyProject, companyWide, projectField }) => {
    if (everyProject) return companyWide ? null : { [projectField]: { $nin: [null, undefined] } };
    const inProjects = { [projectField]: { $in: projectIds } };
    return companyWide ? { $or: [inProjects, { [projectField]: { $in: [null, undefined] } }] } : inProjects;
};

/* Who reaches a page, as a query: the private-doc rule, then where the page is filed. A page under
 * no project is the company's, and `companyWide` says whether this reader takes those. `projectIds`
 * go into the query as given, so the caller casts them the way its own query needs.
 * pageReachedBy is the same rule over a loaded row: change both together. */
const pageReachFilter = ({ uid, projectIds = [], everyProject = false, companyWide = true, projectField = 'ProjectID', exceptProjectIds = [] }) => {
    const filed = inReachableProjects({ projectIds, everyProject, companyWide, projectField });
    return {
        $and: [
            pageVisibilityFilter(uid),
            ...(filed ? [filed] : []),
            ...(exceptProjectIds.length ? [{ [projectField]: { $nin: exceptProjectIds } }] : []),
        ],
    };
};

const pageReachedBy = (page, { uid, inProject = () => false, everyProject = false, companyWide = true }) => {
    if (!pageVisibleTo(page, uid)) return false;
    if (!page.ProjectID) return companyWide;
    return everyProject || Boolean(inProject(page.ProjectID));
};

/* Whoever can read a doc may comment on it; a doc in the trash is read-only. */
const pageTakesComments = (page) => Boolean(page) && Number(page.deletedStatusKey || 0) === 0;

/* Once private, a page is readable by its author alone, so nobody else may make it private. */
const canMakePrivate = (page, uid) => Boolean(page) && Boolean(uid) && String(page.createdBy || '') === String(uid);

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
    pageVisibleTo,
    pageVisibilityFilter,
    pageReachFilter,
    pageReachedBy,
    pageTakesComments,
    canMakePrivate,
    parseDate,
    nextReviewDate,
    reviewState,
};

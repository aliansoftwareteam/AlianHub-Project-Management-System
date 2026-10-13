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

/* The privacy half of the rule alone: a private page is its author's. Whoever it is shared with by name
 * reaches it through pageReachFilter, pageReachedBy or canUsePage, never through this. */
const pageVisibleTo = (page, uid) => Boolean(page)
    && (String(page.visibility || '') !== 'private' || String(page.createdBy || '') === String(uid || ''));

const pageVisibilityFilter = (uid) => ({ $or: [{ visibility: { $ne: 'private' } }, { createdBy: String(uid || '') }] });

const MAX_PAGE_SHARES = 50;
const SHARE_ROLES = Object.freeze(['viewer', 'editor']);

const sharesOf = (page) => (page && Array.isArray(page.sharedWith) ? page.sharedWith : []).filter((entry) => entry && entry.userId);

const shareFor = (page, uid) => (uid ? sharesOf(page).find((entry) => String(entry.userId) === String(uid)) || null : null);

const sharedWithFilter = (uid) => ({ sharedWith: { $elemMatch: { userId: String(uid || '') } } });

/* A reader learns that a doc is shared with them, and in which role; who else it is shared with is the
 * managers' to see, through the shares routes. Changes and returns the plain row it is given. */
const hideShares = (row, uid) => {
    const mine = shareFor(row, uid);
    row.sharedWithMe = mine ? String(mine.role) : '';
    delete row.sharedWith;
    delete row.sharesTold;
    return row;
};

/* Who reaches a page, as a query: a page shared with the reader by name, or else the private-doc rule and
 * where the page is filed. A page under no project is the company's, and `companyWide` says whether this
 * reader takes those. `named: false` leaves out the pages reached only by name; `namedProjectIds` keeps
 * those to some projects, for a reader that must not leave them. `projectIds` and `namedProjectIds` go
 * into the query as given, so the caller casts them the way its own query needs. `sharedAsIds` is for a
 * copy that keeps the named people as bare user ids.
 * pageReachedBy is the same rule over a loaded row: change both together. */
const pageReachFilter = ({
    uid, projectIds = [], companyWide = true, projectField = 'ProjectID', exceptProjectIds = [],
    named = true, namedProjectIds = null, sharedAsIds = false,
}) => {
    const inProjects = { [projectField]: { $in: projectIds } };
    const filed = [
        pageVisibilityFilter(uid),
        companyWide ? { $or: [inProjects, { [projectField]: { $in: [null, undefined] } }] } : inProjects,
        ...(exceptProjectIds.length ? [{ [projectField]: { $nin: exceptProjectIds } }] : []),
    ];
    if (!named || !uid) return { $and: filed };
    const namedTo = sharedAsIds ? { sharedWith: String(uid) } : sharedWithFilter(uid);
    const shared = namedProjectIds ? { $and: [namedTo, { [projectField]: { $in: namedProjectIds } }] } : namedTo;
    return { $and: [{ $or: [{ $and: filed }, shared] }] };
};

const pageReachedBy = (page, { uid, inProject = () => false, companyWide = true, named = true, namedProjectIds = null }) => {
    if (!page) return false;
    if (pageVisibleTo(page, uid) && (page.ProjectID ? Boolean(inProject(page.ProjectID)) : companyWide)) return true;
    if (!named || !shareFor(page, uid)) return false;
    return !namedProjectIds || (Boolean(page.ProjectID) && namedProjectIds.map(String).includes(String(page.ProjectID)));
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
    MAX_PAGE_SHARES,
    SHARE_ROLES,
    sharesOf,
    shareFor,
    sharedWithFilter,
    hideShares,
    pageReachFilter,
    pageReachedBy,
    pageTakesComments,
    canMakePrivate,
    parseDate,
    nextReviewDate,
    reviewState,
};

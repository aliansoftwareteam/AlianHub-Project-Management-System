// Global-search rules. Pure — no I/O — shared by controller and tests.

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const RESULT_LIMIT_PER_TYPE = 10;

/* Validate the search input. Returns { valid, reason }. */
const validateSearchInput = ({ companyId, query }) => {
    if (!companyId) {
        return { valid: false, reason: 'companyId is required.' };
    }
    const trimmed = String(query || '').trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
        return { valid: false, reason: `Query must be at least ${MIN_QUERY_LENGTH} characters.` };
    }
    if (trimmed.length > MAX_QUERY_LENGTH) {
        return { valid: false, reason: `Query must be at most ${MAX_QUERY_LENGTH} characters.` };
    }
    return { valid: true, reason: '' };
};

/* Truncate long comment bodies for result rows. */
const truncate = (text, max = 120) => {
    const value = String(text || '');
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

module.exports = {
    MIN_QUERY_LENGTH,
    MAX_QUERY_LENGTH,
    RESULT_LIMIT_PER_TYPE,
    validateSearchInput,
    truncate,
};

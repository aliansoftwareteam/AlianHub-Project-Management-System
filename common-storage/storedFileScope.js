const ENFORCE = 'enforce';
const REPORT = 'report';

const scopeMode = () => (String(process.env.STORAGE_DOWNLOAD_SCOPE || '').trim().toLowerCase() === ENFORCE ? ENFORCE : REPORT);

const reported = new Map();

/* Counts per category only: what the owner reads to decide when to enforce, never a key or path. */
const countReported = (category) => {
    const count = (reported.get(category) || 0) + 1;
    reported.set(category, count);
    return count;
};

const reportedCounts = () => Object.fromEntries(reported);

module.exports = { ENFORCE, REPORT, scopeMode, countReported, reportedCounts };

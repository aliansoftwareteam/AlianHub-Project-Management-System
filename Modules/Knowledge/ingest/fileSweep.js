// The index that finds owed files is partial, and MongoDB only uses a partial index for a query
// it can prove falls inside the index's filter, so the filter and the queries live together here.

const OWED = { $type: 'date' };
const INDEX_KEY = { sourceType: 1, extractDueAt: 1 };
const INDEX_OPTIONS = { partialFilterExpression: { extractDueAt: OWED } };
const DUE_SORT = { extractDueAt: 1 };

const pendingFilter = () => ({ sourceType: 'file', extractDueAt: { ...OWED }, ordinal: 0 });

const dueFilter = (now) => ({ sourceType: 'file', extractDueAt: { ...OWED, $lte: new Date(now) }, ordinal: 0 });

module.exports = { INDEX_KEY, INDEX_OPTIONS, DUE_SORT, pendingFilter, dueFilter };

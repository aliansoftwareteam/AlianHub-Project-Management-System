// The purge's index is partial, and MongoDB only uses a partial index for a query it can prove
// falls inside the index's filter, so the filter and the queries live together here. Nothing is
// required: the chunk schema declares the index from this file.

const INDEX_KEY = { deletedAt: 1 };
const INDEX_OPTIONS = { partialFilterExpression: { deleted: true } };

/* Tombstones the indexer reads back: a deleted task's marker is how its restore finds the comments
 * and files to bring back, a departed member's agent-note marker is how a rejoin finds the notes,
 * and a file's skip or failure outcome keeps it from being read again. */
const KEPT_REASONS = Object.freeze([
    'task',
    'departed',
    'skipped:linked', 'skipped:unsupported', 'skipped:too_large', 'skipped:empty', 'skipped:unreadable',
    'skipped:foreign_key', 'skipped:type_mismatch', 'skipped:inflated_too_large',
    'extract:failed', 'extract:timed_out', 'extract:too_much_memory',
]);

const expired = (cutoff) => ({ deleted: true, deletedAt: { $lt: new Date(cutoff) }, extractDueAt: { $exists: false } });

const removableFilter = (cutoff) => ({ ...expired(cutoff), $or: [{ tombstoneReason: { $nin: KEPT_REASONS } }, { ordinal: { $gt: 0 } }] });

const blankableFilter = (cutoff) => ({
    ...expired(cutoff), tombstoneReason: { $in: KEPT_REASONS }, ordinal: 0, $or: [{ text: { $ne: '' } }, { 'embedding.0': { $exists: true } }],
});

module.exports = { INDEX_KEY, INDEX_OPTIONS, KEPT_REASONS, removableFilter, blankableFilter };

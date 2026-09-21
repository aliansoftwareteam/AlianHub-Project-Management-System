const fileSweep = require('./ingest/fileSweep');

// The one aggregation behind a workspace's figures, apart from the module that runs it so it can be
// explained against a real server. It starts with a match the unique index on source type serves,
// but every count it makes needs fields that index does not hold (deleted, embedding model, text), so
// the server still fetches each chunk; the vector is fetched with the document but never enters the
// pipeline, and text size is estimated from the text alone.

/* Markers the indexer writes for its own bookkeeping, not reasons a file was left out. */
const NOT_A_REASON = ['', 'task'];
const LIVE = { deleted: { $ne: true } };

const figuresPipeline = (sourceTypes, retried, maxAttempts) => [
    { $match: { sourceType: { $in: sourceTypes } } },
    {
        $project: {
            sourceType: 1, sourceId: 1, deleted: 1, embeddingModel: 1, updatedAt: 1, ordinal: 1, tombstoneReason: 1, extractAttempts: 1, extractDueAt: 1,
            textBytes: { $strLenBytes: { $ifNull: ['$text', ''] } },
        },
    },
    {
        $facet: {
            bySource: [{ $group: { _id: { sourceType: '$sourceType', deleted: '$deleted' }, chunks: { $sum: 1 }, textBytes: { $sum: '$textBytes' }, lastAt: { $max: '$updatedAt' } } }],
            sources: [{ $match: LIVE }, { $group: { _id: { sourceType: '$sourceType', sourceId: '$sourceId' } } }, { $group: { _id: '$_id.sourceType', sources: { $sum: 1 } } }],
            byModel: [{ $match: LIVE }, { $group: { _id: '$embeddingModel', chunks: { $sum: 1 } } }],
            fileReasons: [
                { $match: { sourceType: 'file', ordinal: 0, deleted: true, tombstoneReason: { $nin: NOT_A_REASON, $type: 'string' } } },
                { $group: { _id: '$tombstoneReason', count: { $sum: 1 } } },
            ],
            fileExhausted: [
                { $match: { sourceType: 'file', ordinal: 0, deleted: true, tombstoneReason: { $in: retried }, extractAttempts: { $gte: maxAttempts } } },
                { $group: { _id: '$tombstoneReason', count: { $sum: 1 } } },
            ],
            filesPending: [{ $match: fileSweep.pendingFilter() }, { $count: 'n' }],
        },
    },
];

module.exports = { figuresPipeline };

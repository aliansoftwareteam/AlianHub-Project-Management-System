// The aggregations behind a workspace's figures, apart from the module that runs them so they can be
// explained against a real server. The two that span every chunk read only fields FIGURES_INDEX_KEY
// holds, the size included (stored as `textBytes` when a chunk is written), so the server answers
// them from the index without fetching a chunk. Only the file tombstones behind the reasons a file
// was left out are fetched.

const FIGURES_INDEX_KEY = { sourceType: 1, deleted: 1, sourceId: 1, embeddingModel: 1, updatedAt: 1, textBytes: 1 };

/* Markers the indexer writes for its own bookkeeping, not reasons a file was left out. */
const NOT_A_REASON = ['', 'task'];

const totalsPipeline = (sourceTypes) => [
    { $match: { sourceType: { $in: sourceTypes } } },
    {
        $group: {
            _id: { sourceType: '$sourceType', deleted: '$deleted', embeddingModel: '$embeddingModel' },
            chunks: { $sum: 1 },
            textBytes: { $sum: '$textBytes' },
            lastAt: { $max: '$updatedAt' },
        },
    },
];

const sourcesPipeline = (sourceTypes) => [
    { $match: { sourceType: { $in: sourceTypes }, deleted: { $ne: true } } },
    { $group: { _id: { sourceType: '$sourceType', sourceId: '$sourceId' } } },
    { $group: { _id: '$_id.sourceType', sources: { $sum: 1 } } },
];

const fileReasonsPipeline = (retried, maxAttempts) => [
    { $match: { sourceType: 'file', deleted: true, ordinal: 0, tombstoneReason: { $nin: NOT_A_REASON, $type: 'string' } } },
    { $project: { _id: 0, tombstoneReason: 1, extractAttempts: 1 } },
    {
        $facet: {
            fileReasons: [{ $group: { _id: '$tombstoneReason', count: { $sum: 1 } } }],
            fileExhausted: [
                { $match: { tombstoneReason: { $in: retried }, extractAttempts: { $gte: maxAttempts } } },
                { $group: { _id: '$tombstoneReason', count: { $sum: 1 } } },
            ],
        },
    },
];

module.exports = { FIGURES_INDEX_KEY, totalsPipeline, sourcesPipeline, fileReasonsPipeline };

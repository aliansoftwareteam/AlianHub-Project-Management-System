// Sources the chunk store holds, in backfill order. Tasks are still searched from their rows.
const INDEXED_SOURCES = ['page', 'comment', 'transcript'];

// Media and system comments carry no text worth retrieving.
const COMMENT_TYPES = ['text', 'link'];

module.exports = { INDEXED_SOURCES, COMMENT_TYPES };

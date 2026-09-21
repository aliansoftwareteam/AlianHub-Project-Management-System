// Sources the chunk store holds, in backfill order: files last, since each one costs a read from
// storage and a parse. Tasks are still searched from their rows.
const INDEXED_SOURCES = ['page', 'comment', 'transcript', 'guide', 'file'];

// A guide is one field of its project and a file's text exists nowhere but in its chunks, so
// neither has rows to search while its chunk store is not built.
const CHUNK_ONLY_SOURCES = ['guide', 'file'];

// Media and system comments carry no text worth retrieving.
const COMMENT_TYPES = ['text', 'link'];

module.exports = { INDEXED_SOURCES, CHUNK_ONLY_SOURCES, COMMENT_TYPES };

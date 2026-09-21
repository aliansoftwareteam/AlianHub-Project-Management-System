// What one file may cost the indexer, each overridable from the environment and read on every
// call. A value that is not a positive number falls back to its default.

const MB = 1024 * 1024;

const positive = (raw, fallback) => {
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

const limits = () => ({
    maxBytes: positive(process.env.KNOWLEDGE_FILE_MAX_BYTES, 10 * MB),
    maxChars: positive(process.env.KNOWLEDGE_FILE_MAX_CHARS, 200000),
    timeoutMs: positive(process.env.KNOWLEDGE_FILE_TIMEOUT_MS, 20000),
    maxPages: positive(process.env.KNOWLEDGE_FILE_MAX_PAGES, 200),
    maxSheets: positive(process.env.KNOWLEDGE_FILE_MAX_SHEETS, 20),
    maxRows: positive(process.env.KNOWLEDGE_FILE_MAX_ROWS, 5000),
    maxUnzippedBytes: positive(process.env.KNOWLEDGE_FILE_MAX_UNZIPPED_BYTES, 100 * MB),
});

module.exports = { limits };

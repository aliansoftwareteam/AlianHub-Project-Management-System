// What one file may cost the indexer, each overridable from the environment and read on every
// call. A value that is not a positive number falls back to its default.

const MB = 1024 * 1024;

const positive = (raw, fallback) => {
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

/* A rebuilt archive holds at most the budget, and while it is built one more entry of at most the
 * budget is held beside it; the rest is the parser's own working memory. */
const PARSER_HEADROOM = 128 * MB;

const limits = () => {
    const maxUnzippedBytes = positive(process.env.KNOWLEDGE_FILE_MAX_UNZIPPED_BYTES, 100 * MB);
    return {
        maxBytes: positive(process.env.KNOWLEDGE_FILE_MAX_BYTES, 10 * MB),
        maxChars: positive(process.env.KNOWLEDGE_FILE_MAX_CHARS, 200000),
        timeoutMs: positive(process.env.KNOWLEDGE_FILE_TIMEOUT_MS, 20000),
        maxPages: positive(process.env.KNOWLEDGE_FILE_MAX_PAGES, 200),
        maxSheets: positive(process.env.KNOWLEDGE_FILE_MAX_SHEETS, 20),
        maxRows: positive(process.env.KNOWLEDGE_FILE_MAX_ROWS, 5000),
        maxUnzippedBytes,
        maxParseMemoryBytes: positive(process.env.KNOWLEDGE_FILE_MAX_PARSE_MEMORY_BYTES, 2 * maxUnzippedBytes + PARSER_HEADROOM),
    };
};

module.exports = { limits };

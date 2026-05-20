const fs = require('fs');
const path = require('path');
const os = require('os');
const multer = require('multer');

const MAX_BRIEF_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_BRIEF_CHARS = 100000;
const ALLOWED_MIME = new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
]);

// Disk-buffer to a temp dir; we delete the file right after parsing.
const briefStorage = multer.diskStorage({
    destination: function (_req, _file, cb) {
        const dir = path.join(os.tmpdir(), 'alianhub-ai-briefs');
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: function (_req, file, cb) {
        const safe = String(file.originalname || 'brief')
            .replace(/[^a-zA-Z0-9._-]/g, '_')
            .slice(0, 80);
        cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`);
    },
});

const briefUpload = multer({
    storage: briefStorage,
    limits: { fileSize: MAX_BRIEF_BYTES, files: 1 },
    fileFilter: function (_req, file, cb) {
        if (!ALLOWED_MIME.has(file.mimetype)) {
            return cb(new Error(`Unsupported file type: ${file.mimetype}`));
        }
        cb(null, true);
    },
});

// Build the control-char regex from String.fromCharCode so no actual control
// bytes live in this source file (they're brittle across editors/encodings).
const CONTROL_CHARS = (() => {
    const codes = [];
    for (let i = 0; i <= 8; i++) codes.push(i); // 0x00..0x08
    codes.push(11, 12);                          // 0x0B, 0x0C
    for (let i = 14; i <= 31; i++) codes.push(i); // 0x0E..0x1F
    codes.push(127);                              // 0x7F (DEL)
    return new RegExp('[' + codes.map((c) => String.fromCharCode(c)).join('') + ']', 'g');
})();

function stripControlChars(text) {
    if (typeof text !== 'string') return '';
    return text.replace(CONTROL_CHARS, '');
}

function truncate(text) {
    if (text.length <= MAX_BRIEF_CHARS) return { text, truncated: false };
    return { text: text.slice(0, MAX_BRIEF_CHARS), truncated: true };
}

async function extractFromFile(file) {
    if (!file) throw new Error('No file uploaded');
    const buffer = fs.readFileSync(file.path);
    let raw = '';
    if (file.mimetype === 'application/pdf') {
        // pdf-parse@2.x ships a class-based API. We use { data: buffer } to
        // feed an in-memory PDF rather than letting it fetch a URL.
        const { PDFParse } = require('pdf-parse');
        const parser = new PDFParse({ data: buffer });
        try {
            const parsed = await parser.getText();
            raw = (parsed && parsed.text) || '';
        } finally {
            try { await parser.destroy(); } catch (_e) { /* ignore */ }
        }
    } else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        raw = result.value || '';
    } else if (file.mimetype === 'text/plain' || file.mimetype === 'text/markdown') {
        raw = buffer.toString('utf8');
    } else {
        throw new Error(`Unsupported mime: ${file.mimetype}`);
    }

    const cleaned = stripControlChars(raw).trim();
    if (!cleaned) throw new Error('No readable text found in the uploaded file');
    const { text, truncated } = truncate(cleaned);
    return {
        text,
        truncated,
        originalLength: cleaned.length,
        finalLength: text.length,
        mimetype: file.mimetype,
        // Rough token estimate (~4 chars per token for English).
        tokenEstimate: Math.ceil(text.length / 4),
    };
}

function safeUnlink(filePath) {
    try { fs.unlinkSync(filePath); } catch (_e) { /* ignore */ }
}

module.exports = {
    briefUpload,
    extractFromFile,
    safeUnlink,
    MAX_BRIEF_BYTES,
    MAX_BRIEF_CHARS,
};

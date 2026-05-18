const path = require('path');

/**
 * Shared multer hardening helpers.
 *
 * - `DEFAULT_LIMITS` bounds the request size so an unbounded upload
 *   can't fill disk or exhaust memory. Operators can raise via env.
 * - `safeFileFilter` rejects extensions that are commonly used to
 *   smuggle native executables onto the server. It is a blocklist, not
 *   an allowlist, because the app legitimately accepts a wide range of
 *   project files (designs, archives, source dumps, media, etc.).
 * - `safeRelativePath` rejects path-traversal attempts before multer
 *   writes anything to disk. Returns the cleaned relative path, or
 *   null if the input is unsafe.
 */

const DEFAULT_LIMITS = {
    fileSize: Number(process.env.UPLOAD_MAX_FILE_BYTES || 100 * 1024 * 1024), // 100 MB
    files: Number(process.env.UPLOAD_MAX_FILES || 20),
};

const BLOCKED_EXTENSIONS = new Set([
    '.exe', '.bat', '.cmd', '.com', '.scr', '.msi', '.cpl', '.vbs',
    '.vbe', '.ps1', '.psm1', '.psd1', '.jse', '.wsf', '.wsh', '.lnk',
    '.hta', '.pif', '.application', '.gadget', '.msp', '.dll', '.sys',
    '.bin', '.sh',
]);

function safeFileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
        const err = new Error(`File extension "${ext}" is not allowed`);
        err.code = 'UNSUPPORTED_FILE_TYPE';
        return cb(err);
    }
    cb(null, true);
}

function safeRelativePath(input) {
    if (typeof input !== 'string' || input.length === 0) return null;
    if (input.startsWith('/') || input.startsWith('\\')) return null;
    if (input.includes('..')) return null;
    if (input.includes('\0')) return null;
    // Normalize and verify it still doesn't escape.
    const normalized = path.posix.normalize(input.replace(/\\/g, '/'));
    if (normalized.startsWith('..') || normalized.startsWith('/')) return null;
    return normalized;
}

module.exports = {
    DEFAULT_LIMITS,
    BLOCKED_EXTENSIONS,
    safeFileFilter,
    safeRelativePath,
};

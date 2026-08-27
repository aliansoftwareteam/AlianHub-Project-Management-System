const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
const logger = require('../../../Config/loggerConfig');
const { putLocalFile } = require('../../../common-storage/putLocalFile');

// Attaching a file to a Development-tab message.
//
// Unlike the public form upload, this one is behind the app's own auth: every
// route under /api/v2/dev-agent carries JWT+company (or the runner's PAT), so
// the caller is a known member of a known company. What still has to be checked
// here is the file itself, and the key it is stored under.

const MAX_FILE_BYTES = Number(process.env.DEV_ATTACHMENT_MAX_BYTES || 10 * 1024 * 1024);
const MAX_PER_MESSAGE = Number(process.env.DEV_ATTACHMENT_MAX_COUNT || 5);

/* What a developer actually hands an AI agent: a screenshot, a log, a spec, a
 * dump of data. Extension and declared mime must agree — the browser picks the
 * mime and the filename is user text, so neither is trusted alone.
 *
 * Nothing a browser will execute is on the list. These files are served back
 * through the app's own origin, where there is no nosniff header, so an .html or
 * .svg attachment would be same-origin script running against a member's
 * session. The same reason the form upload refuses them. */
const ALLOWED = Object.freeze({
    png: { mimes: ['image/png'], type: 'image' },
    jpg: { mimes: ['image/jpeg'], type: 'image' },
    jpeg: { mimes: ['image/jpeg'], type: 'image' },
    gif: { mimes: ['image/gif'], type: 'image' },
    webp: { mimes: ['image/webp'], type: 'image' },
    pdf: { mimes: ['application/pdf'], type: 'application' },
    txt: { mimes: ['text/plain'], type: 'text' },
    log: { mimes: ['text/plain', 'application/octet-stream'], type: 'text' },
    md: { mimes: ['text/markdown', 'text/plain', 'application/octet-stream'], type: 'text' },
    json: { mimes: ['application/json', 'text/plain'], type: 'text' },
    csv: { mimes: ['text/csv', 'application/vnd.ms-excel', 'text/plain'], type: 'text' },
    zip: { mimes: ['application/zip', 'application/x-zip-compressed'], type: 'application' },
    docx: { mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], type: 'application' },
    xlsx: { mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], type: 'application' },
});

const ACCEPT_ATTR = Object.keys(ALLOWED).map((e) => `.${e}`).join(',');

/* Where every key this module mints begins. Checked again when a message claims
 * an attachment, so a caller cannot point a message at some other object in the
 * company's bucket and have the runner fetch it. */
const KEY_PREFIX = 'devAttachment/';

const extensionOf = (name) => {
    const dot = String(name || '').lastIndexOf('.');
    return dot === -1 ? '' : String(name).slice(dot + 1).toLowerCase();
};

/* Readable, but stripped of anything a filesystem, a header or a page could read
 * as syntax. It never reaches disk — the stored name is random. */
const safeName = (name) => {
    const base = String(name || 'file').split(/[\\/]/).pop();
    const cleaned = base.replace(/[\x00-\x1f<>:"|?*]/g, '').trim();
    return (cleaned || 'file').slice(0, 120);
};

const TMP_DIR = path.join(os.tmpdir(), 'alianhub-dev-attachments');

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            try { fs.mkdirSync(TMP_DIR, { recursive: true }); cb(null, TMP_DIR); } catch (e) { cb(e); }
        },
        // None of the submitted name reaches the filesystem.
        filename: (req, file, cb) => cb(null, `${Date.now()}_${crypto.randomBytes(8).toString('hex')}`),
    }),
    limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 20, fieldSize: 8192, fieldNameSize: 64 },
    fileFilter: (req, file, cb) => {
        const entry = ALLOWED[extensionOf(file.originalname)];
        if (!entry || !entry.mimes.includes(String(file.mimetype).toLowerCase())) {
            const err = new Error('UNSUPPORTED_FILE_TYPE');
            err.code = 'UNSUPPORTED_FILE_TYPE';
            return cb(err);
        }
        return cb(null, true);
    },
});

const MESSAGE = Object.freeze({
    LIMIT_FILE_SIZE: `Each file must be under ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB.`,
    LIMIT_FILE_COUNT: 'Attach one file per upload.',
    UNSUPPORTED_FILE_TYPE: 'That file type is not accepted.',
    UPLOAD_FAILED: 'The file could not be uploaded.',
});

/* Multer's error is answered here rather than stashed: unlike the public form,
 * this endpoint's only job is the upload, so there is no later step that could
 * report it better. */
const parseOne = (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (!err) return next();
        logger.error(`dev attachment refused: ${err.code || err.message}`);
        return res.send({ status: false, statusText: MESSAGE[err.code] || MESSAGE.UPLOAD_FAILED });
    });
};

const unlinkQuietly = (p) => {
    if (!p) return;
    try { fs.unlinkSync(p); } catch (e) { /* already gone */ }
};

// The scope segment of a key. Sanitised rather than interpolated: it arrives
// from the request, and '..' or a slash in it would place the object outside
// this module's prefix — in another company's tree, given the bucket is the
// company. Ids are hex/ObjectId shaped, so anything else is not a real scope.
const scopeSegment = (scope) => String(scope || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);

/**
 * Store one uploaded file and describe it.
 *
 * The key is built here from the company, the scope (task or conversation) and a
 * random component — never from the uploaded name — so a crafted filename cannot
 * choose where the object lands or what content type it is later served as.
 */
const storeAttachment = async ({ companyId, scope, file }) => {
    const ext = extensionOf(file.originalname);
    const entry = ALLOWED[ext];
    if (!entry) { unlinkQuietly(file.path); return { ok: false, reason: MESSAGE.UNSUPPORTED_FILE_TYPE }; }
    if (Number(file.size) > MAX_FILE_BYTES) { unlinkQuietly(file.path); return { ok: false, reason: MESSAGE.LIMIT_FILE_SIZE }; }

    const segment = scopeSegment(scope);
    if (!segment) { unlinkQuietly(file.path); return { ok: false, reason: 'A task or conversation is required.' }; }
    const key = `${KEY_PREFIX}${segment}/${crypto.randomBytes(12).toString('hex')}.${ext}`;
    try {
        const stored = await putLocalFile({
            companyId,
            storagePath: key,
            tmpPath: file.path,
            filename: safeName(file.originalname),
            size: Number(file.size) || 0,
        });
        // The wasabi branch consumes the source; the server branch copies it.
        if (!stored.consumedSource) unlinkQuietly(file.path);
        return {
            ok: true,
            attachment: {
                id: crypto.randomBytes(9).toString('hex').slice(0, 17),
                filename: safeName(file.originalname),
                extension: ext,
                size: Number(file.size) || 0,
                type: entry.type,
                url: stored.key,
            },
        };
    } catch (e) {
        unlinkQuietly(file.path);
        logger.error(`dev attachment store failed: ${e.message}`);
        return { ok: false, reason: MESSAGE.UPLOAD_FAILED };
    }
};

/**
 * The attachments a message may carry, rebuilt field by field.
 *
 * The browser sends back descriptors it was given, so nothing here is trusted:
 * every field is re-typed and bounded, the extension must still be on the
 * allow-list, and the key must be one this module mints. Without that last check
 * a message could name any object in the company's bucket and have the runner
 * download it.
 */
const normalizeAttachments = (raw) => {
    const list = Array.isArray(raw) ? raw.slice(0, MAX_PER_MESSAGE) : [];
    const out = [];
    for (const a of list) {
        if (!a || typeof a !== 'object') continue;
        const url = String(a.url || '');
        const ext = extensionOf(a.filename) || String(a.extension || '').toLowerCase();
        if (!url.startsWith(KEY_PREFIX) || url.includes('..')) continue;
        if (!ALLOWED[ext]) continue;
        out.push({
            id: String(a.id || crypto.randomBytes(9).toString('hex')).slice(0, 40),
            filename: safeName(a.filename),
            extension: ext,
            size: Math.max(0, Math.min(Number(a.size) || 0, MAX_FILE_BYTES)),
            type: ALLOWED[ext].type,
            url,
        });
    }
    return out;
};

module.exports = {
    parseOne,
    storeAttachment,
    normalizeAttachments,
    ACCEPT_ATTR,
    ALLOWED,
    KEY_PREFIX,
    MAX_FILE_BYTES,
    MAX_PER_MESSAGE,
    safeName,
    extensionOf,
};

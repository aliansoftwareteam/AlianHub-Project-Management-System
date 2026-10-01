const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
const logger = require('../../../Config/loggerConfig');
const { putLocalFile } = require('../../../common-storage/putLocalFile');

// Receiving a file from an anonymous submitter.
//
// Two things make this different from every other upload in the app: there is no
// authenticated user, and the page that posts here runs no JavaScript, so the
// browser posts a plain multipart form and every check has to happen server-side.

const MAX_FILE_BYTES = Number(process.env.FORM_MAX_FILE_BYTES || 10 * 1024 * 1024);
const MAX_FILES = Number(process.env.FORM_MAX_FILES || 3);

/* Extension AND declared mime must agree. Neither is trusted alone: the browser
 * chooses the mime, and the filename is submitter text.
 *
 * Nothing that a browser will render as a document is on this list. An uploaded
 * .html or .svg would be served back from the app's own origin by the server
 * driver — with no nosniff and no Content-Disposition — which is same-origin
 * stored XSS against a staff member who opens the attachment. The wasabi driver
 * stores .svg as image/svg+xml and hands out a 24h presigned url, which is a live
 * scripted page on a link the customer will trust. Refusing them here is the
 * control; adding those two headers to the read paths is the real fix and is a
 * separate change. */
const ALLOWED = Object.freeze({
    pdf: { mimes: ['application/pdf'], type: 'application' },
    png: { mimes: ['image/png'], type: 'image' },
    jpg: { mimes: ['image/jpeg'], type: 'image' },
    jpeg: { mimes: ['image/jpeg'], type: 'image' },
    gif: { mimes: ['image/gif'], type: 'image' },
    webp: { mimes: ['image/webp'], type: 'image' },
    txt: { mimes: ['text/plain'], type: 'text' },
    csv: { mimes: ['text/csv', 'application/vnd.ms-excel', 'text/plain'], type: 'text' },
    doc: { mimes: ['application/msword'], type: 'application' },
    docx: { mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], type: 'application' },
    xls: { mimes: ['application/vnd.ms-excel'], type: 'application' },
    xlsx: { mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], type: 'application' },
    ppt: { mimes: ['application/vnd.ms-powerpoint'], type: 'application' },
    pptx: { mimes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'], type: 'application' },
    zip: { mimes: ['application/zip', 'application/x-zip-compressed'], type: 'application' },
});

const ACCEPT_ATTR = Object.keys(ALLOWED).map((e) => `.${e}`).join(',');

const extensionOf = (name) => {
    const dot = String(name || '').lastIndexOf('.');
    return dot === -1 ? '' : String(name).slice(dot + 1).toLowerCase();
};

/* The name shown on the attachment. Kept readable but stripped of anything that
 * could matter to a filesystem, a header or a page: no separators, no control
 * characters, no angle brackets. It never reaches disk — see the storage below. */
const safeName = (name) => {
    const base = String(name || 'file').split(/[\\/]/).pop();
    // eslint-disable-next-line no-control-regex
    const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, '').trim();
    return (cleaned || 'file').slice(0, 120);
};

const TMP_DIR = path.join(os.tmpdir(), 'alianhub-form-uploads');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        try {
            fs.mkdirSync(TMP_DIR, { recursive: true });
            cb(null, TMP_DIR);
        } catch (e) {
            cb(e);
        }
    },
    // No part of the submitter's filename reaches the filesystem, so a crafted
    // name cannot traverse or collide.
    filename: (req, file, cb) => cb(null, `${Date.now()}_${crypto.randomBytes(8).toString('hex')}`),
});

const upload = multer({
    storage,
    limits: {
        fileSize: MAX_FILE_BYTES,
        files: MAX_FILES,
        // A labels question sends one field per checked option, and a form may
        // hold 50 questions of up to 40 options — so the field cap has to clear
        // ~2000 or large existing forms would start failing.
        fields: 2200,
        parts: 2210,
        fieldSize: 32768,
        fieldNameSize: 64,
    },
    fileFilter: (req, file, cb) => {
        const ext = extensionOf(file.originalname);
        const entry = ALLOWED[ext];
        if (!entry || !entry.mimes.includes(String(file.mimetype).toLowerCase())) {
            const err = new Error('UNSUPPORTED_FILE_TYPE');
            err.code = 'UNSUPPORTED_FILE_TYPE';
            err.field = file.fieldname;
            return cb(err);
        }
        return cb(null, true);
    },
});

const unlinkQuietly = (p) => {
    if (!p) return;
    try { fs.unlinkSync(p); } catch (e) { /* already gone, or never written */ }
};

/* Multer's own errors are stashed rather than answered.
 *
 * An abort happens before the token has been resolved, so there is no form yet —
 * no title, no theme, no question to attach the message to. Continuing lets the
 * handler resolve the form first and then render the failure through the same
 * per-field mechanism every other validation error uses. Multer has already
 * deleted its temp file and drained the request by this point. */
const parse = (req, res, next) => {
    // Multer is a pass-through for non-multipart requests, so a form with no file
    // question keeps using the globally-parsed urlencoded body untouched.
    const declared = Number(req.headers['content-length'] || 0);
    const ceiling = MAX_FILES * MAX_FILE_BYTES + (2 * 1024 * 1024);
    if (declared && declared > ceiling) {
        // Busboy has no whole-request limit, and the 2mb body-parser cap does not
        // apply to multipart. Absent on a chunked upload, which this cannot cover.
        req.uploadError = { code: 'LIMIT_REQUEST_SIZE' };
        return next();
    }
    return upload.any()(req, res, (err) => {
        if (err) {
            req.uploadError = { code: err.code || 'UPLOAD_FAILED', field: err.field };
            logger.error(`form upload refused: ${err.code || err.message}`);
        }
        next();
    });
};

const UPLOAD_MESSAGE = Object.freeze({
    LIMIT_FILE_SIZE: `Each file must be under ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB.`,
    LIMIT_FILE_COUNT: `Attach at most ${MAX_FILES} files.`,
    LIMIT_REQUEST_SIZE: 'That upload is too large.',
    UNSUPPORTED_FILE_TYPE: 'That file type is not accepted.',
    LIMIT_FIELD_VALUE: 'One of the answers is too long.',
    LIMIT_FIELD_COUNT: 'That is more answers than this form accepts.',
    UPLOAD_FAILED: 'The file could not be uploaded. Please try again.',
});

const messageFor = (code) => UPLOAD_MESSAGE[code] || UPLOAD_MESSAGE.UPLOAD_FAILED;

/* A browser cannot repopulate a file input, so any bounce costs the submitter the
 * file. Saying so is kinder than leaving them to notice. */
const REPICK = 'Please choose the file again.';

/**
 * Store the files a submission carried, one per question.
 *
 * Ordering matters and is the point of this function: the form is resolved, then
 * each file is matched to a VISIBLE question of type `files` on that form, then
 * checked, and only then written. A file for a question that does not exist —
 * or a rejected submission — never reaches the tenant's bucket.
 *
 * Returns { files, errors, cleanup } where `files` is a Map of questionId ->
 * descriptor, and `cleanup` unlinks every temp path this did not hand to storage.
 */
const storeSubmissionFiles = async ({ companyId, form, questions, incoming }) => {
    const files = new Map();
    const errors = {};
    const temps = new Set((incoming || []).map((f) => f.path).filter(Boolean));

    const cleanup = () => { for (const p of temps) unlinkQuietly(p); temps.clear(); };

    const byId = new Map(questions.filter((q) => q.type === 'files').map((q) => [q.id, q]));

    for (const file of incoming || []) {
        const question = byId.get(file.fieldname);
        if (!question) {
            // Mirrors how answers are handled: the form's own list decides what is
            // accepted, never the payload's keys.
            unlinkQuietly(file.path);
            temps.delete(file.path);
            continue;
        }
        if (files.has(question.id)) {
            unlinkQuietly(file.path);
            temps.delete(file.path);
            continue;
        }

        const ext = extensionOf(file.originalname);
        const entry = ALLOWED[ext];
        if (!entry) {
            errors[question.id] = `${UPLOAD_MESSAGE.UNSUPPORTED_FILE_TYPE} ${REPICK}`;
            continue;
        }
        if (Number(file.size) > MAX_FILE_BYTES) {
            errors[question.id] = `${UPLOAD_MESSAGE.LIMIT_FILE_SIZE} ${REPICK}`;
            continue;
        }

        // Every part of the key is server-derived. The extension comes from the
        // allow-list entry, not from the submitted name, so a submitter cannot
        // choose the Content-Type the file is later served with.
        const key = `formAttachment/${String(form._id)}/${crypto.randomBytes(12).toString('hex')}.${ext}`;
        try {
            const stored = await putLocalFile({
                companyId,
                storagePath: key,
                tmpPath: file.path,
                filename: safeName(file.originalname),
                size: Number(file.size) || 0,
            });
            if (stored.consumedSource) temps.delete(file.path);
            files.set(question.id, {
                id: crypto.randomBytes(9).toString('hex').slice(0, 17),
                filename: safeName(file.originalname),
                extension: ext,
                size: Number(file.size) || 0,
                type: entry.type,
                url: stored.key,
                createdAt: new Date(),
                userId: String((form.userSnapshot && form.userSnapshot.id) || form.createdBy || ''),
            });
        } catch (e) {
            logger.error(`form upload: storing failed (${e.message})`);
            errors[question.id] = `${UPLOAD_MESSAGE.UPLOAD_FAILED} ${REPICK}`;
        }
    }

    return { files, errors, cleanup };
};

/* For a post that is answered without being read as a submission. */
const discardFiles = (incoming) => {
    for (const file of incoming || []) unlinkQuietly(file && file.path);
};

module.exports = {
    parse,
    storeSubmissionFiles,
    discardFiles,
    messageFor,
    REPICK,
    ACCEPT_ATTR,
    ALLOWED,
    MAX_FILE_BYTES,
    MAX_FILES,
    safeName,
    extensionOf,
};

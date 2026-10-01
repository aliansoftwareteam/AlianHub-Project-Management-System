'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
const { putLocalFile } = require('../../../common-storage/putLocalFile');
const { guardFile, getLimits } = require('../../../utils/imageGuard');

/* Formats a browser renders only as a picture. SVG is left out on purpose: served from the
 * app's origin or a presigned link it is a scripted document, not an image. */
const IMAGE_TYPES = Object.freeze({
    png: { mimes: ['image/png'], format: 'png' },
    jpg: { mimes: ['image/jpeg'], format: 'jpeg' },
    jpeg: { mimes: ['image/jpeg'], format: 'jpeg' },
    gif: { mimes: ['image/gif'], format: 'gif' },
    webp: { mimes: ['image/webp'], format: 'webp' },
});

const TMP_DIR = path.join(os.tmpdir(), 'alianhub-page-images');

class PageImageError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.name = 'PageImageError';
        this.statusCode = statusCode;
    }
}

const extensionOf = (name) => {
    const dot = String(name || '').lastIndexOf('.');
    return dot === -1 ? '' : String(name).slice(dot + 1).toLowerCase();
};

const unlinkQuietly = (file) => {
    if (!file) return;
    try { fs.unlinkSync(file); } catch (e) { /* never written, or already consumed */ }
};

const uploader = () => multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            try {
                fs.mkdirSync(TMP_DIR, { recursive: true });
                cb(null, TMP_DIR);
            } catch (error) {
                cb(error);
            }
        },
        filename: (req, file, cb) => cb(null, `${Date.now()}_${crypto.randomBytes(8).toString('hex')}`),
    }),
    limits: { fileSize: getLimits().MAX_BYTES, files: 1, fields: 5, parts: 6 },
    fileFilter: (req, file, cb) => {
        const entry = IMAGE_TYPES[extensionOf(file.originalname)];
        if (!entry || !entry.mimes.includes(String(file.mimetype).toLowerCase())) {
            return cb(new PageImageError('Only PNG, JPEG, GIF or WebP images can be added to a doc.'));
        }
        return cb(null, true);
    },
});

const receiveImage = (req, res) => new Promise((resolve, reject) => {
    uploader().single('file')(req, res, (error) => {
        if (!error) return resolve(req.file || null);
        if (error instanceof PageImageError) return reject(error);
        if (error.code === 'LIMIT_FILE_SIZE') {
            return reject(new PageImageError(`Images must be under ${Math.floor(getLimits().MAX_BYTES / (1024 * 1024)) || 1} MB.`, 413));
        }
        return reject(new PageImageError('The image could not be read.'));
    });
});

/* The bytes decide, not the name: sharp reads the header, so a renamed file or a pixel bomb stops here. */
const checkImage = async (file) => {
    const entry = IMAGE_TYPES[extensionOf(file.originalname)];
    let meta;
    try {
        meta = await guardFile(file.path);
    } catch (error) {
        if (error && error.statusCode === 413) throw new PageImageError('That image is too large.', 413);
        throw new PageImageError('That file is not an image.');
    }
    if (!entry || !meta || meta.format !== entry.format) throw new PageImageError('That file is not an image of the type its name says.');
    return entry;
};

const storePageImage = async ({ companyId, pageId, file }) => {
    let consumed = false;
    try {
        await checkImage(file);
        const ext = extensionOf(file.originalname) === 'jpeg' ? 'jpg' : extensionOf(file.originalname);
        const stored = await putLocalFile({
            companyId: String(companyId),
            storagePath: `Pages/${pageId}/${crypto.randomBytes(12).toString('hex')}.${ext}`,
            tmpPath: file.path,
            filename: `image.${ext}`,
            size: Number(file.size) || 0,
        });
        consumed = stored.consumedSource;
        return stored.key;
    } finally {
        if (!consumed) unlinkQuietly(file.path);
    }
};

module.exports = { IMAGE_TYPES, PageImageError, receiveImage, storePageImage, unlinkQuietly };

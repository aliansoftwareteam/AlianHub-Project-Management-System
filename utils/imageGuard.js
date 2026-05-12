/**
 * Image upload guard (BUG-023 / #77 fix).
 *
 * `sharp(file.path)` was previously invoked with no validation on either
 * the input file size or its pixel dimensions. An authenticated user
 * could upload a 50 MB pixel-bomb PNG (e.g. 30000×30000) and crash the
 * worker via OOM — `bodyParser` only limits the request envelope, not
 * what sharp/libvips materialises in memory.
 *
 * This helper performs two cheap pre-checks before any `sharp(...).resize`
 * call:
 *
 *   1. **File size**: rejects inputs larger than `MAX_IMAGE_FILE_BYTES`
 *      (default 25 MB).
 *   2. **Pixel dimensions**: rejects images with more than
 *      `MAX_IMAGE_PIXELS` total pixels (default 50 megapixels — e.g.
 *      ~7100×7100 square). Pixel count is read from `sharp(input).metadata()`
 *      which only parses the header, NOT the whole image, so the read
 *      itself is bounded.
 *
 * Both limits are env-tunable. Failures throw an `ImageGuardError` with
 * a stable `code` so callers can return a proper 4xx instead of crashing.
 */
'use strict';

const sharp = require('sharp');
const fs = require('fs');

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;      // 25 MB
const DEFAULT_MAX_PIXELS = 50 * 1000 * 1000;     // 50 megapixels

const getLimits = () => ({
    MAX_BYTES: Math.max(1024, Number(process.env.MAX_IMAGE_FILE_BYTES) || DEFAULT_MAX_BYTES),
    MAX_PIXELS: Math.max(1, Number(process.env.MAX_IMAGE_PIXELS) || DEFAULT_MAX_PIXELS),
});

class ImageGuardError extends Error {
    constructor(message, code, details) {
        super(message);
        this.name = 'ImageGuardError';
        this.code = code;
        this.statusCode = 413;
        this.details = details;
    }
}

const checkFileSizeBytes = (size) => {
    const { MAX_BYTES } = getLimits();
    if (typeof size !== 'number' || !Number.isFinite(size)) return;
    if (size > MAX_BYTES) {
        throw new ImageGuardError(
            `Image file size ${size} bytes exceeds limit of ${MAX_BYTES} bytes`,
            'IMAGE_TOO_LARGE',
            { size, maxBytes: MAX_BYTES }
        );
    }
};

const checkPathSize = (filePath) => {
    let stats;
    try {
        stats = fs.statSync(filePath);
    } catch (_) {
        return; // let sharp surface the file-not-found path
    }
    checkFileSizeBytes(stats.size);
};

const checkBufferSize = (buffer) => {
    if (!buffer || typeof buffer.length !== 'number') return;
    checkFileSizeBytes(buffer.length);
};

const checkDimensions = async (input) => {
    const { MAX_PIXELS } = getLimits();
    const meta = await sharp(input).metadata();
    const w = meta && meta.width ? meta.width : 0;
    const h = meta && meta.height ? meta.height : 0;
    const pixels = w * h;
    if (pixels > MAX_PIXELS) {
        throw new ImageGuardError(
            `Image dimensions ${w}x${h} (${pixels} pixels) exceed limit of ${MAX_PIXELS} pixels`,
            'IMAGE_TOO_MANY_PIXELS',
            { width: w, height: h, pixels, maxPixels: MAX_PIXELS }
        );
    }
    return meta;
};

const guardFile = async (filePath) => {
    checkPathSize(filePath);
    return await checkDimensions(filePath);
};

const guardBuffer = async (buffer) => {
    checkBufferSize(buffer);
    return await checkDimensions(buffer);
};

module.exports = {
    ImageGuardError,
    getLimits,
    checkFileSizeBytes,
    checkPathSize,
    checkBufferSize,
    checkDimensions,
    guardFile,
    guardBuffer,
};

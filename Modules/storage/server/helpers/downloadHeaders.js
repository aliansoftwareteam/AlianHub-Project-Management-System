const path = require('path');

/* Uploads are served from the app's own origin, so only types a browser renders without running script are sent
 * inline; everything else downloads as bytes. Chrome and Firefox still open a PDF under the sandboxing policy. */
const INLINE_TYPES = Object.freeze({
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain; charset=utf-8',
    '.log': 'text/plain; charset=utf-8',
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.ogv': 'video/ogg',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
});
const DOWNLOAD_TYPE = 'application/octet-stream';
const SANDBOX_POLICY = "default-src 'none'; sandbox";

const attachment = (filePath) => {
    const name = path.basename(filePath).replace(/["\\\r\n]/g, '_');
    const ascii = name.replace(/[^\x20-\x7e]/g, '_');
    return ascii === name ? `attachment; filename="${name}"` : `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};

const headersFor = (filePath, { download = false } = {}) => {
    const inlineType = INLINE_TYPES[path.extname(filePath).toLowerCase()];
    const headers = {
        'Content-Type': inlineType || DOWNLOAD_TYPE,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': SANDBOX_POLICY,
    };
    if (!inlineType || download) headers['Content-Disposition'] = attachment(filePath);
    return headers;
};

/* send() keeps a Content-Type that is already set, so the headers go on before sendFile. */
const sendStoredFile = (res, filePath, options) => {
    res.set(headersFor(filePath, options));
    res.sendFile(filePath, () => {});
};

module.exports = { INLINE_TYPES, DOWNLOAD_TYPE, SANDBOX_POLICY, headersFor, sendStoredFile };

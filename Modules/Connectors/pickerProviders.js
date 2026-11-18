/* Pure metadata for the attachment picker (076). No DB, no network, no env — a constant or a pure function,
 * so it is unit-testable and safe to require anywhere.
 *
 * An attachment record stores a stable `source` ('google_drive' | 'dropbox'); the module provider that backs it
 * is 'google' (its Drive product) or 'dropbox'. Keeping the source key stable means files linked before 076 keep
 * rendering. Every picker route takes the source and maps it here to a provider, a product and the scope a pick
 * needs, plus where the server downloads bytes and previews from. */

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DROPBOX_DOWNLOAD = 'https://content.dropboxapi.com/2/files/download';

const SOURCES = Object.freeze({
    google_drive: Object.freeze({
        source: 'google_drive',
        provider: 'google',
        product: 'drive',
        scope: 'https://www.googleapis.com/auth/drive.file',
        // The Picker needs the owner's own access token; the Chooser-style tokenless pick is Dropbox only.
        needsToken: true,
    }),
    dropbox: Object.freeze({
        source: 'dropbox',
        provider: 'dropbox',
        product: 'files',
        scope: 'files.content.read',
        // The Dropbox Chooser signs the person in itself with the app key, so link-mode picking needs no token.
        needsToken: false,
    }),
});

const SOURCE_KEYS = Object.keys(SOURCES);
const bySource = (key) => SOURCES[String(key || '')] || null;
const isSource = (key) => !!bySource(key);

const clip = (value, max = 512) => String(value === null || value === undefined ? '' : value).slice(0, max);
const isHttpsUrl = (value) => /^https:\/\/[^\s]+$/i.test(String(value || ''));

/* Is this a Dropbox content URL the server may fetch? The Chooser's `direct` link arrives from the browser, so a
 * client-supplied URL handed to server-side axios is textbook SSRF (file://, 169.254.169.254, an internal port);
 * it is matched against an explicit host allow-list, parsed with URL() so `https://good@evil.com/` resolves to
 * its real host and is rejected. */
const DROPBOX_CONTENT_HOSTS = new Set(['dl.dropboxusercontent.com', 'www.dropbox.com', 'dropbox.com', 'content.dropboxapi.com']);
const isDropboxContentUrl = (value) => {
    const raw = String(value || '');
    if (!isHttpsUrl(raw)) return false;
    let parsed;
    try { parsed = new URL(raw); } catch (e) { return false; }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase();
    return DROPBOX_CONTENT_HOSTS.has(host) || host.endsWith('.dl.dropboxusercontent.com');
};

/* Where the server downloads the bytes from for "import a copy", using the owner's own connection token. Google
 * takes the file id in the path with ?alt=media; Dropbox takes it in a header and the body is empty. */
const downloadRequestFor = (source, fileId) => {
    const meta = bySource(source);
    if (!meta) return null;
    const id = clip(fileId, 512);
    if (meta.source === 'google_drive') return { url: `${DRIVE_FILES}/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, method: 'get', headers: {}, host: 'www.googleapis.com' };
    if (meta.source === 'dropbox') return { url: DROPBOX_DOWNLOAD, method: 'post', headers: { 'Dropbox-API-Arg': JSON.stringify({ path: id }) }, host: 'content.dropboxapi.com' };
    return null;
};

/* A preview image for one linked file, resolved per render because providers issue these as short-lived URLs.
 * The Picker returns none for Drive files (its iconUrl is a 16px glyph), so one is fetched; the Dropbox Chooser
 * already hands a thumbnailLink back client-side, so there is nothing to fetch. */
const thumbnailRequestFor = (source, fileId) => {
    const meta = bySource(source);
    if (!meta || meta.source !== 'google_drive') return null;
    const id = clip(fileId, 512);
    return {
        url: `${DRIVE_FILES}/${encodeURIComponent(id)}?fields=thumbnailLink,hasThumbnail&supportsAllDrives=true`,
        host: 'www.googleapis.com',
        pick: (d) => (d && d.hasThumbnail && d.thumbnailLink ? String(d.thumbnailLink) : ''),
    };
};

module.exports = {
    SOURCES, SOURCE_KEYS, bySource, isSource,
    clip, isHttpsUrl, isDropboxContentUrl, DROPBOX_CONTENT_HOSTS,
    downloadRequestFor, thumbnailRequestFor,
};

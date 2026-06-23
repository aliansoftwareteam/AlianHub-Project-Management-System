// Clips (COLLAB-04) — pure rule helpers. No DB / network / mongoose here so they
// can be unit-tested in isolation (see tests/clips-rules.test.js), mirroring
// Modules/Notes/notesRules.js.

// A clip is a reusable recording asset. mediaType describes the kind of media
// (video / audio); source describes how it was captured (screen capture, voice
// only, or screen+mic). Unknown values are normalised away so a hostile or
// malformed body can't smuggle arbitrary strings into those fields.
const MEDIA_TYPES = ['video', 'audio'];
const SOURCES = ['screen', 'voice', 'screenMic'];

// Normalise mediaType to one of MEDIA_TYPES, or '' when unrecognised.
function normalizeMediaType(value) {
    const v = typeof value === 'string' ? value.trim() : '';
    return MEDIA_TYPES.includes(v) ? v : '';
}

// Normalise source to one of SOURCES, or '' when unrecognised.
function normalizeSource(value) {
    const v = typeof value === 'string' ? value.trim() : '';
    return SOURCES.includes(v) ? v : '';
}

// A clip record is persistable only if it carries a media url — the file itself
// is uploaded through the EXISTING storage endpoint and this record just points
// at it, so without a url there is nothing to reference.
function canPersistClip(clip) {
    if (!clip) return false;
    const url = typeof clip.url === 'string' ? clip.url.trim() : '';
    return url.length > 0;
}

// Normalise an incoming create/update payload to the clip fields we persist.
// Anything not listed here is dropped (the schema is strict anyway). `undefined`
// fields are omitted so an update only sets what was sent. Enum-ish fields
// (mediaType / source) are clamped to their allow-lists.
function sanitizeClipPayload(body) {
    const b = body || {};
    const out = {};
    if (b.title !== undefined) out.title = typeof b.title === 'string' ? b.title : String(b.title || '');
    if (b.url !== undefined) out.url = typeof b.url === 'string' ? b.url : String(b.url || '');
    if (b.mediaType !== undefined) out.mediaType = normalizeMediaType(b.mediaType);
    if (b.mimeType !== undefined) out.mimeType = typeof b.mimeType === 'string' ? b.mimeType : String(b.mimeType || '');
    if (b.size !== undefined) out.size = Number(b.size) || 0;
    if (b.durationSec !== undefined) out.durationSec = Number(b.durationSec) || 0;
    if (b.source !== undefined) out.source = normalizeSource(b.source);
    return out;
}

module.exports = {
    MEDIA_TYPES,
    SOURCES,
    normalizeMediaType,
    normalizeSource,
    canPersistClip,
    sanitizeClipPayload,
};

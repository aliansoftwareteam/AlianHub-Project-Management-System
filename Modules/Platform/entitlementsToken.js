const crypto = require('crypto');
const hostingMode = require('../../Config/hostingMode');

const MAX_FUTURE_MS = 5 * 60 * 1000;
const SEGMENT = /^[A-Za-z0-9_-]+$/;

const fail = (code, message) => ({ ok: false, code, message });

const decodeJson = (segment) => {
    try {
        const value = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch {
        return null;
    }
};

/* Compact JWS, alg EdDSA (Ed25519), checked with Node's crypto alone. The signature is checked
 * before anything in the payload is believed. */
function verifyEntitlementsToken(token, { publicKey = hostingMode.ed25519PublicKey(process.env.PLATFORM_PUBLIC_KEY), instanceId = process.env.INSTANCE_ID || '', now = Date.now() } = {}) {
    if (!publicKey) return fail('no_key', 'PLATFORM_PUBLIC_KEY is not an Ed25519 public key.');
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || !parts.every((part) => SEGMENT.test(part))) return fail('malformed', 'The token is not a compact JWS.');
    const [headerPart, payloadPart, signaturePart] = parts;
    const header = decodeJson(headerPart);
    if (!header || header.alg !== 'EdDSA') return fail('bad_alg', 'The token must be signed with EdDSA.');
    let signed = false;
    try {
        signed = crypto.verify(null, Buffer.from(`${headerPart}.${payloadPart}`), publicKey, Buffer.from(signaturePart, 'base64url'));
    } catch {
        signed = false;
    }
    if (!signed) return fail('bad_signature', 'The token signature does not verify.');
    const payload = decodeJson(payloadPart);
    if (!payload) return fail('malformed', 'The token payload is not a JSON object.');
    if (!instanceId || payload.instanceId !== instanceId) return fail('wrong_instance', 'The token is for another instance.');
    if (!Number.isInteger(payload.version) || payload.version < 1) return fail('malformed', 'The token has no version.');
    const issuedAt = new Date(payload.issuedAt).getTime();
    if (!Number.isFinite(issuedAt)) return fail('malformed', 'The token has no issuedAt.');
    if (issuedAt - now > MAX_FUTURE_MS) return fail('future_issued', 'The token is issued in the future.');
    return { ok: true, header, payload };
}

module.exports = { verifyEntitlementsToken, MAX_FUTURE_MS };

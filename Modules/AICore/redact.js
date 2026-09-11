const MASK = '[redacted]';

const SECRET_KEY = '[^"\\\\]*(?:password|passwd|secret|token|api[_-]?key)[^"\\\\]*';
const JSON_SECRET = new RegExp(`("${SECRET_KEY}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, 'gi');
const ESCAPED_JSON_SECRET = new RegExp(`(\\\\"${SECRET_KEY}\\\\"\\s*:\\s*)\\\\"[^"]*?\\\\"`, 'gi');

const TOKEN_PATTERNS = [
    [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, MASK],
    [/\b(Bearer)\s+[A-Za-z0-9\-._~+/]{8,}=*/gi, `$1 ${MASK}`],
    [/\bsk-[A-Za-z0-9_-]{16,}/g, MASK],
    [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, MASK],
    [/\bxox[a-z]-[A-Za-z0-9-]{10,}/g, MASK],
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, MASK],
    [/\b[a-fA-F0-9]{32,}\b/g, MASK],
];

// Mixed case plus a digit keeps long camel-free words and URL paths out of the base64 net.
const BASE64 = /[A-Za-z0-9+/_]{40,}={0,2}/g;
const looksEncoded = (s) => /[A-Z]/.test(s) && /[a-z]/.test(s) && /\d/.test(s);

function redact(text) {
    if (typeof text !== 'string') return text;
    let out = text.replace(JSON_SECRET, `$1"${MASK}"`).replace(ESCAPED_JSON_SECRET, `$1\\"${MASK}\\"`);
    TOKEN_PATTERNS.forEach(([pattern, replacement]) => { out = out.replace(pattern, replacement); });
    return out.replace(BASE64, (match) => (looksEncoded(match) ? MASK : match));
}

const contentText = (content) => (typeof content === 'string' ? content : JSON.stringify(content === undefined ? null : content));

const redactMessages = (messages) => (Array.isArray(messages) ? messages : []).map((m) => ({ role: (m && m.role) || null, content: redact(contentText(m && m.content)) }));

module.exports = { redact, redactMessages, MASK };

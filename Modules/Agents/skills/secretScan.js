// Conservative on purpose: only shapes that are credentials by construction
// (vendor prefixes, key blocks, a password inside a link), never an entropy
// guess, so an ordinary brief or a commit hash is not refused.

const WITH_DIGIT_AND_LETTER = '(?=[A-Za-z0-9_.~+/-]*\\d)(?=[A-Za-z0-9_.~+/-]*[A-Za-z])';

const PATTERNS = Object.freeze([
    ['a GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}/],
    ['a GitHub token', /\bgithub_pat_[A-Za-z0-9_]{22,}/],
    ['a GitLab token', /\bglpat-[A-Za-z0-9_-]{20,}/],
    ['a model provider key', new RegExp(`\\bsk-${WITH_DIGIT_AND_LETTER}[A-Za-z0-9_-]{20,}`)],
    ['an AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
    ['a Google API key', /\bAIza[0-9A-Za-z_-]{35}/],
    ['a Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
    ['a Stripe key', /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/],
    ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['a signed token', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
    ['a bearer token', new RegExp(`\\bBearer\\s+${WITH_DIGIT_AND_LETTER}[A-Za-z0-9._~+/-]{20,}`, 'i')],
    ['a password in a link', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@{}]+:[^\s/@{}]+@/i],
    ['a key in a link', /[?&](?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|token|secret|client[_-]?secret|password|passwd|pwd)=(?=[^&#\s{]*\d)(?=[^&#\s{]*[A-Za-z])[^&#\s{]{12,}/i],
]);

const MAX_DEPTH = 12;

const kindOf = (text) => {
    const hit = PATTERNS.find(([, re]) => re.test(text));
    return hit ? hit[0] : null;
};

/* One finding per field, naming what the value looks like and never the value. */
const findSecrets = (value, field = '', found = [], depth = 0) => {
    if (depth > MAX_DEPTH) return found;
    if (typeof value === 'string') {
        const kind = kindOf(value);
        if (kind) found.push({ field, kind });
    } else if (Array.isArray(value)) {
        value.forEach((item, i) => findSecrets(item, `${field}[${i}]`, found, depth + 1));
    } else if (value !== null && typeof value === 'object') {
        Object.keys(value).forEach((key) => findSecrets(value[key], field ? `${field}.${key}` : key, found, depth + 1));
    }
    return found;
};

module.exports = { findSecrets, PATTERNS };

const { isBlank } = require('./shared');

const MAX_LENGTH = 2048;
const SAFE_PROTOCOLS = ['http:', 'https:'];
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;
const SAFE_START = /^https?:\/\//i;

const NOT_A_LINK = 'A link must start with http:// or https://.';

const parsed = (value) => {
    if (typeof value !== 'string') return null;
    const candidate = value.trim();
    if (!candidate || candidate.length > MAX_LENGTH || !SAFE_START.test(candidate)) return null;
    try {
        const link = new URL(candidate);
        return SAFE_PROTOCOLS.includes(link.protocol) && link.hostname ? link : null;
    } catch (_error) {
        return null;
    }
};

/* The only way a stored value becomes an href. It is read again on every render, so a value that reached storage some other way is never a link. */
const safeHref = (value) => {
    const link = parsed(value);
    return link ? link.href : '';
};

const hostOf = (value) => {
    const link = parsed(value);
    return link ? link.host : '';
};

const settings = () => ({ settings: {} });

function parse(value) {
    if (isBlank(value)) return { value: '' };
    const href = safeHref(value);
    return href ? { value: href } : { error: NOT_A_LINK };
}

/* People type "example.com/page"; a scheme they did type is kept, and parse refuses it unless it is http or https. */
const fromInput = (typed) => {
    if (typeof typed !== 'string') return typed;
    const trimmed = typed.trim();
    return !trimmed || HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;
};

const text = (value) => safeHref(value);

function sortValue(value) {
    const link = parsed(value);
    return link ? `${link.host}${link.pathname}${link.search}`.toLowerCase() : null;
}

module.exports = { type: 'url', empty: '', MAX_LENGTH, safeHref, hostOf, settings, parse, fromInput, text, sortValue };

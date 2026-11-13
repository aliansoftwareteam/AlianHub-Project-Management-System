const MAX_LENGTH = 2048;

/* Browsers read "//host" and "/\host" as another site, so only a single leading slash keeps a return path on this one. */
const sameOriginPath = (raw) => {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value || value.length > MAX_LENGTH) return '';
    if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '';
    return value;
};

module.exports = { sameOriginPath };

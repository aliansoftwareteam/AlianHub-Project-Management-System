/**
 * Escapes a string for safe use inside a MongoDB $regex / $regexMatch
 * or a native JavaScript RegExp constructor.
 *
 * Without this, a search payload like "(a+)+" causes ReDoS, and
 * patterns like ".*" let a tenant enumerate other documents by name.
 *
 * Returns an empty string for null/undefined input so callers can
 * still build a query object without explicit guards.
 */
function escapeRegex(input) {
    if (input === null || input === undefined) return '';
    return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { escapeRegex };

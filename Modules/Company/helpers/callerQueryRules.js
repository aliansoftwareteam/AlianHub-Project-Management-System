const { escapeRegex } = require('../../../utils/escapeRegex');

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const MAX_DEPTH = 40;
const MAX_ITEM_ID_LENGTH = 128;
const MAX_SEARCH_TEXT = 200;

/* What a query sent by a caller never holds: a read of another collection, a write, server-side JavaScript, or a server diagnostic. */
const FORBIDDEN_OPERATORS = Object.freeze([
    '$where', '$function', '$accumulator', '$lookup', '$graphLookup', '$unionWith', '$out', '$merge',
    '$documents', '$collStats', '$indexStats', '$planCacheStats', '$currentOp', '$listSessions', '$listLocalSessions', '$changeStream',
]);

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));

const TOO_DEEP = Symbol('too deep');

/* The first operator of `forbidden` a caller's query holds, at any depth, or TOO_DEEP when it nests past the cap. */
const forbiddenOperatorIn = (value, forbidden = FORBIDDEN_OPERATORS, depth = 0) => {
    if (!Array.isArray(value) && !isPlainObject(value)) return null;
    if (depth > MAX_DEPTH) return TOO_DEEP;
    if (Array.isArray(value)) {
        for (const item of value) {
            const hit = forbiddenOperatorIn(item, forbidden, depth + 1);
            if (hit) return hit;
        }
        return null;
    }
    for (const [key, inner] of Object.entries(value)) {
        if (forbidden.includes(key)) return key;
        const hit = forbiddenOperatorIn(inner, forbidden, depth + 1);
        if (hit) return hit;
    }
    return null;
};

const NESTED_TOO_DEEPLY = 'A query cannot be nested this deeply.';

const queryRefusal = (value, forbidden = FORBIDDEN_OPERATORS) => {
    const hit = forbiddenOperatorIn(value, forbidden);
    if (!hit) return null;
    return hit === TOO_DEEP ? NESTED_TOO_DEEPLY : `${hit} is not allowed in a query.`;
};

const badRequest = (res, message) => res.status(400).json({ status: false, statusText: 'Bad Request', message });

const SEARCH_TEXT_TOO_LONG = `Search for at most ${MAX_SEARCH_TEXT} characters.`;
const SEARCH_TEXT_NOT_TEXT = 'Search text must be plain text.';
const MATCH_FLAGS = /^[imsxu]*$/;
const TEXT_MATCH_EXPRESSIONS = Object.freeze(['$regexMatch', '$regexFind', '$regexFindAll']);

class SearchTextRefused extends Error {
    constructor(message) {
        super(message);
        this.name = 'SearchTextRefused';
    }
}

/* What a person typed, as the pattern that matches exactly that text. It is escaped here and nowhere else: a client
 * sends the text as typed, so a backslash in it is a backslash to find and never the mark of text escaped already. */
const textPattern = (typed) => {
    if (typeof typed !== 'string') throw new SearchTextRefused(SEARCH_TEXT_NOT_TEXT);
    if (typed.length > MAX_SEARCH_TEXT) throw new SearchTextRefused(SEARCH_TEXT_TOO_LONG);
    return escapeRegex(typed);
};

const checkedFlags = (flags) => {
    if (flags !== undefined && (typeof flags !== 'string' || !MATCH_FLAGS.test(flags))) throw new SearchTextRefused(SEARCH_TEXT_NOT_TEXT);
    return flags;
};

/* A copy of a caller's query in which every text match ($regex, $regexMatch and its kin) matches its text literally. */
const withPlainSearchText = (value, depth = 0) => {
    if (depth > MAX_DEPTH) throw new SearchTextRefused(NESTED_TOO_DEEPLY);
    if (Array.isArray(value)) return value.map((item) => withPlainSearchText(item, depth + 1));
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => {
        if (key === '$regex') return [key, textPattern(inner)];
        if (key === '$options') return [key, checkedFlags(inner)];
        if (TEXT_MATCH_EXPRESSIONS.includes(key) && isPlainObject(inner)) {
            checkedFlags(inner.options);
            return [key, { ...withPlainSearchText(inner, depth + 1), regex: textPattern(inner.regex) }];
        }
        return [key, withPlainSearchText(inner, depth + 1)];
    }));
};

/* Each named body field is a filter: a plain object, or the JSON text of one. The parsed object replaces the text, so the handler reads what was checked. */
const limitCallerFilters = (...names) => (req, res, next) => {
    const body = req.body || {};
    for (const name of names) {
        if (typeof body[name] === 'string') {
            try {
                body[name] = JSON.parse(body[name]);
            } catch {
                return badRequest(res, `${name} must be a filter object.`);
            }
        }
        const filter = body[name];
        if (filter === undefined || filter === null) continue;
        if (!isPlainObject(filter)) return badRequest(res, `${name} must be a filter object.`);
        const reason = queryRefusal(filter);
        if (reason) return badRequest(res, reason);
        try {
            body[name] = withPlainSearchText(filter);
        } catch (error) {
            if (!(error instanceof SearchTextRefused)) throw error;
            return badRequest(res, error.message);
        }
    }
    return next();
};

const limitCallerBody = (req, res, next) => {
    const reason = queryRefusal(req.body);
    if (reason) return badRequest(res, reason);
    try {
        req.body = withPlainSearchText(req.body);
    } catch (error) {
        if (!(error instanceof SearchTextRefused)) throw error;
        return badRequest(res, error.message);
    }
    return next();
};

const isObjectIdText = (value) => typeof value === 'string' && OBJECT_ID_PATTERN.test(value);

/* The id of a list item (a checklist row, a tag) reaches arrayFilters and $pull as a value, never as an operator object. */
const isItemId = (value) => (typeof value === 'string' && value.length > 0 && value.length <= MAX_ITEM_ID_LENGTH) || Number.isFinite(value);

module.exports = {
    MAX_SEARCH_TEXT,
    SearchTextRefused,
    withPlainSearchText,
    OBJECT_ID_PATTERN,
    FORBIDDEN_OPERATORS,
    TOO_DEEP,
    NESTED_TOO_DEEPLY,
    isPlainObject,
    forbiddenOperatorIn,
    queryRefusal,
    badRequest,
    limitCallerFilters,
    limitCallerBody,
    isObjectIdText,
    isItemId,
};

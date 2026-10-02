const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const MAX_DEPTH = 40;
const MAX_ITEM_ID_LENGTH = 128;

/* What a query sent by a caller never holds: a read of another collection, a write, server-side JavaScript, or a server diagnostic. */
const FORBIDDEN_OPERATORS = Object.freeze([
    '$where', '$function', '$accumulator', '$lookup', '$graphLookup', '$unionWith', '$out', '$merge',
    '$documents', '$collStats', '$indexStats', '$planCacheStats', '$currentOp', '$listSessions', '$listLocalSessions', '$changeStream',
]);

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));

const queryRefusal = (value, forbidden = FORBIDDEN_OPERATORS, depth = 0) => {
    if (!Array.isArray(value) && !isPlainObject(value)) return null;
    if (depth > MAX_DEPTH) return 'A query cannot be nested this deeply.';
    if (Array.isArray(value)) {
        for (const item of value) {
            const reason = queryRefusal(item, forbidden, depth + 1);
            if (reason) return reason;
        }
        return null;
    }
    for (const [key, inner] of Object.entries(value)) {
        if (forbidden.includes(key)) return `${key} is not allowed in a query.`;
        const reason = queryRefusal(inner, forbidden, depth + 1);
        if (reason) return reason;
    }
    return null;
};

const badRequest = (res, message) => res.status(400).json({ status: false, statusText: 'Bad Request', message });

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
    }
    return next();
};

const limitCallerBody = (req, res, next) => {
    const reason = queryRefusal(req.body);
    return reason ? badRequest(res, reason) : next();
};

const isObjectIdText = (value) => typeof value === 'string' && OBJECT_ID_PATTERN.test(value);

/* The id of a list item (a checklist row, a tag) reaches arrayFilters and $pull as a value, never as an operator object. */
const isItemId = (value) => (typeof value === 'string' && value.length > 0 && value.length <= MAX_ITEM_ID_LENGTH) || Number.isFinite(value);

module.exports = {
    OBJECT_ID_PATTERN,
    FORBIDDEN_OPERATORS,
    isPlainObject,
    queryRefusal,
    badRequest,
    limitCallerFilters,
    limitCallerBody,
    isObjectIdText,
    isItemId,
};

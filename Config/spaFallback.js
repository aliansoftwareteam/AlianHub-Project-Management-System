const path = require('path');

/* Prefixes the server owns. Anything else that a browser asks for as a page is
 * a client route, so a hard refresh or a shared link gets the SPA instead of
 * "Cannot GET". Server-rendered pages (share, form, connections) are registered
 * earlier, so Express never reaches this for them; only unmatched paths arrive. */
const RESERVED = /^\/(api\/|mcp(\/|$)|scim\/|socket\.io\/|health$)/;

const wantsSpa = (req) => req.method === 'GET'
    && !RESERVED.test(req.path)
    && !path.extname(req.path)
    && Boolean(req.accepts && req.accepts('html'));

const spaFallback = (indexFile) => (req, res, next) => (wantsSpa(req) ? res.sendFile(indexFile) : next());

module.exports = { RESERVED, wantsSpa, spaFallback };

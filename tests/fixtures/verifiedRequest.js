// A request reaches a handler through the session middleware, which sets the token's audience; a hand-built
// request stands for a token that holds whichever company its header names, unless it sets `aud` itself.
module.exports = (req) => ({ aud: req.headers && req.headers.companyid, ...req });

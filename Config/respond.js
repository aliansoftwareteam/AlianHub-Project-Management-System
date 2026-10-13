// The app reads {status} from every body and expects HTTP 200; strictStatus turns
// `statusCode` into a real code for callers that ask for one.
const ok = (res, payload = {}) => res.send({ status: true, ...payload });

const fail = (res, statusText, statusCode = 400, extra = {}) => res.send({ status: false, statusText, statusCode, ...extra });

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { ok, fail, asyncHandler };

const logger = require('./loggerConfig');
const { wantsStatusCodes } = require('./strictStatus');

const statusFor = (err) => {
    const code = Number(err && err.statusCode);
    return code >= 400 && code <= 599 ? code : 500;
};

// Last in the chain: anything thrown or passed to next(err) lands here with the
// request id, instead of Express's HTML page. The app keeps its 200 + {status:false}
// convention; API-token and Prefer: status-codes callers get the real code.
const errorHandler = () => (err, req, res, next) => {
    const requestId = req.requestId || '';
    logger.error(`${requestId} ${req.method} ${req.originalUrl || req.url} failed: ${err && err.stack ? err.stack : err}`);
    if (res.headersSent) return next(err);
    const body = { status: false, statusText: (err && err.message) || 'Something went wrong.', requestId };
    return res.status(wantsStatusCodes(req) ? statusFor(err) : 200).json(body);
};

module.exports = { errorHandler, statusFor };

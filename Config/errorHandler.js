const logger = require('./loggerConfig');
const { wantsStatusCodes } = require('./strictStatus');

const TOO_LARGE = 'LIMIT_FILE_SIZE';

const statusFor = (err) => {
    if (err && err.code === TOO_LARGE) return 413;
    const code = Number(err && err.statusCode);
    return code >= 400 && code <= 599 ? code : 500;
};

/* multer cut an upload off at the largest file allowed: said in the plan's words (064). */
const tooLarge = (err) => {
    if (!(err && err.code === TOO_LARGE)) return null;
    const { maxUploadBytes } = require('../Modules/Entitlements/uploads');
    const { refusalBody } = require('../Modules/Entitlements/answers');
    const limit = maxUploadBytes(Number(process.env.UPLOAD_MAX_FILE_BYTES || 100 * 1024 * 1024));
    const { statusText, code } = refusalBody({ code: 'file_too_large', limit, used: 0 });
    return { statusText, code, limit };
};

// Last in the chain: anything thrown or passed to next(err) lands here with the
// request id, instead of Express's HTML page. The app keeps its 200 + {status:false}
// convention; API-token and Prefer: status-codes callers get the real code.
const errorHandler = () => (err, req, res, next) => {
    const requestId = req.requestId || '';
    logger.error(`${requestId} ${req.method} ${req.originalUrl || req.url} failed: ${err && err.stack ? err.stack : err}`);
    if (res.headersSent) return next(err);
    const body = { status: false, statusText: (err && err.message) || 'Something went wrong.', requestId, ...(tooLarge(err) || {}) };
    return res.status(wantsStatusCodes(req) ? statusFor(err) : 200).json(body);
};

module.exports = { errorHandler, statusFor };

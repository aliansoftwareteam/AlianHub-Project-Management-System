const crypto = require('crypto');
const path = require('path');
const logger = require('./loggerConfig');
const requestContext = require('./requestContext');

const SKIP = /^\/(socket\.io\/|health$)/;
const HEADER = 'X-Request-Id';
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

const shouldLog = (req) => !SKIP.test(req.path) && !path.extname(req.path);

const incomingId = (req) => {
    const value = String(req.headers['x-request-id'] || '');
    return SAFE_ID.test(value) ? value : '';
};

const requestLog = () => (req, res, next) => {
    const id = incomingId(req) || crypto.randomUUID();
    req.requestId = id;
    res.set(HEADER, id);
    if (shouldLog(req)) {
        const started = process.hrtime.bigint();
        res.on('finish', () => {
            const ms = Number(process.hrtime.bigint() - started) / 1e6;
            logger.info(`${id} ${req.method} ${req.originalUrl || req.url} ${res.statusCode} ${ms.toFixed(1)}ms uid=${req.uid || '-'} aud=${req.aud || '-'}`);
        });
    }
    requestContext.run({ id }, next);
};

module.exports = { requestLog, shouldLog, HEADER };

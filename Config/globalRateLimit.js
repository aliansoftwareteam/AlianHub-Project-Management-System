const rateLimit = require('express-rate-limit');

const WINDOW_MS = 60 * 1000;
const DEFAULT_PER_MIN = 1000;
const OFF = ['0', 'off', 'false', 'no', 'disabled'];
const BUSY_CODE = 'server_busy';
const BUSY_TEXT = 'The server is busy. Try again in a moment.';
const STATIC_ASSET_RX = /\.(js|mjs|css|map|svg|png|jpe?g|gif|ico|webp|avif|woff2?|ttf|otf|eot|html?|mp4|webm|mp3|wav|pdf)$/i;

const limitOf = (env = process.env) => {
    const raw = String(env.GLOBAL_RATE_LIMIT_PER_MIN ?? DEFAULT_PER_MIN).trim().toLowerCase();
    if (OFF.includes(raw)) return 0;
    return Math.max(1, Number(raw) || DEFAULT_PER_MIN);
};

// API traffic only: static assets and socket.io are never counted, so an SPA cold load cannot trip the limit.
const uncounted = (req) => req.path.startsWith('/socket.io/') || STATIC_ASSET_RX.test(req.path)
    || req.path === '/' || req.path.startsWith('/assets/') || req.path.startsWith('/static/');

const secondsLeft = (req, res) => {
    const sent = Number(res.get('Retry-After'));
    if (sent > 0) return sent;
    const resetAt = req.rateLimit && req.rateLimit.resetTime ? new Date(req.rateLimit.resetTime).getTime() : 0;
    return Math.max(1, Math.ceil((resetAt ? resetAt - Date.now() : WINDOW_MS) / 1000));
};

const refuse = (req, res) => {
    const retryAfter = secondsLeft(req, res);
    res.set('Retry-After', String(retryAfter));
    res.status(429).json({ status: false, code: BUSY_CODE, statusText: BUSY_TEXT, message: BUSY_TEXT, retryAfter });
};

const install = (app, env = process.env) => {
    const limit = limitOf(env);
    if (!limit) return false;
    app.use(rateLimit({ windowMs: WINDOW_MS, max: limit, standardHeaders: true, legacyHeaders: false, skip: uncounted, handler: refuse }));
    return true;
};

module.exports = { install, limitOf, WINDOW_MS, DEFAULT_PER_MIN, BUSY_CODE, BUSY_TEXT };

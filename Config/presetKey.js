const crypto = require('crypto');
const config = require('./config.js');

const PRESET_KEY_HEADER = 'x-preset-key';
const KEY_IN_URL_HINT = `Send the preset key in the ${PRESET_KEY_HEADER} header instead of the URL.`;

const presented = (req) => {
    const header = req && req.headers ? req.headers[PRESET_KEY_HEADER] : '';
    const body = req && req.body ? req.body.presetKey : '';
    return String(header || body || '');
};

const matchesPresetKey = (req) => {
    const expected = String(config.PRECOMPANYKEY || '');
    const given = presented(req);
    if (!expected || given.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
};

const refusePresetKey = (res) => res.status(401).json({ status: false, statusText: 'Unauthorized', message: 'Unauthorized' });

// The key used to arrive as a path segment, which put it in access logs, proxy logs and
// browser history. The old shape is answered without ever comparing the key, so a request
// made from an old bookmark cannot succeed and cannot confirm the key either.
const refuseKeyInUrl = (res) => res.status(400).json({ status: false, statusText: KEY_IN_URL_HINT, message: KEY_IN_URL_HINT });

module.exports = { PRESET_KEY_HEADER, matchesPresetKey, refusePresetKey, refuseKeyInUrl };

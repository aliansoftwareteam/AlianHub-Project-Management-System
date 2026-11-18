const { isStrict } = require('./apiTokenRules');
const { firstSeenMark } = require('./firstSeen');

const mark = firstSeenMark('apiTokenStrictSince', 'api token strict mode: grace');

const noteStrictMode = () => (isStrict() ? mark.read() : Promise.resolve(null));

module.exports = { FIELD: mark.FIELD, strictSince: mark.read, noteStrictMode, forget: mark.forget };

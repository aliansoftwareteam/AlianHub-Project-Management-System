const logger = require('../../../Config/loggerConfig');
const { isStrict } = require('./apiTokenRules');

const FIELD = 'apiTokenStrictSince';
const RETRY_AFTER_MS = 60 * 1000;

let since = null;
let failedAt = null;

/* Read or recorded once per process, so verifying a token adds no query. When it
 * cannot be read this resolves to null, which the rules treat as a stopped grace;
 * the failure is remembered for a minute so each request does not retry and log. */
const strictSince = async (now = new Date()) => {
    if (since) return since;
    if (failedAt !== null && now.getTime() - failedAt < RETRY_AFTER_MS) return null;
    try {
        since = await require('../../../Config/instanceSettings').markFirstSeen(FIELD, now);
        failedAt = null;
        return since;
    } catch (error) {
        failedAt = now.getTime();
        logger.error(`api token strict mode: grace start not readable, tokens without an expiry are refused for now: ${error.message}`);
        return null;
    }
};

const noteStrictMode = () => (isStrict() ? strictSince() : Promise.resolve(null));

/* A restore can move the stored start, so the next check reads it again. */
const forget = () => {
    since = null;
    failedAt = null;
};

module.exports = { FIELD, strictSince, noteStrictMode, forget };

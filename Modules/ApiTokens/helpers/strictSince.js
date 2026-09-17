const logger = require('../../../Config/loggerConfig');
const { isStrict } = require('./apiTokenRules');

const FIELD = 'apiTokenStrictSince';

let since = null;

/* Read or recorded once per process, so verifying a token adds no query. A failed
 * read is not remembered: the grace counts from now until the database answers. */
const strictSince = async (now = new Date()) => {
    if (since) return since;
    try {
        since = await require('../../../Config/instanceSettings').markFirstSeen(FIELD, now);
        return since;
    } catch (error) {
        logger.error(`api token strict mode: grace start not readable, ${error.message}`);
        return now;
    }
};

const noteStrictMode = () => (isStrict() ? strictSince() : Promise.resolve(null));

module.exports = { strictSince, noteStrictMode };

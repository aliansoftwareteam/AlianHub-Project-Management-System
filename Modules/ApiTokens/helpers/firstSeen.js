const logger = require('../../../Config/loggerConfig');

const RETRY_AFTER_MS = 60 * 1000;

/* One instance-wide moment a rule first applied, read or recorded once per process so
 * verifying a token adds no query. When it cannot be read this resolves to null, which
 * the rules treat as fail-closed; the failure is remembered for a minute so each
 * request does not retry and log. */
const firstSeenMark = (field, label) => {
    let since = null;
    let failedAt = null;

    const read = async (now = new Date()) => {
        if (since) return since;
        if (failedAt !== null && now.getTime() - failedAt < RETRY_AFTER_MS) return null;
        try {
            since = await require('../../../Config/instanceSettings').markFirstSeen(field, now);
            failedAt = null;
            return since;
        } catch (error) {
            failedAt = now.getTime();
            logger.error(`${label}: start not readable, affected tokens are refused for now: ${error.message}`);
            return null;
        }
    };

    /* A restore can move the stored start, so the next check reads it again. */
    const forget = () => {
        since = null;
        failedAt = null;
    };

    return { FIELD: field, read, forget };
};

module.exports = { firstSeenMark };

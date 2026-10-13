const logger = require('../../Config/loggerConfig');

/* A budget that cannot be read is treated as spent: the call is refused rather than
 * let through unmetered, and the failed read is logged. */

const BUDGET_UNAVAILABLE = 'budget_unavailable';
const REASON = `${BUDGET_UNAVAILABLE}: the workspace AI budget could not be checked, so the call was not made`;

const unavailable = (companyId, what, cause) => {
    logger.error(`[ai-budget] ${companyId}: ${what} could not be read; AI calls are refused until it can: ${(cause && cause.message) || cause}`);
    return Object.assign(new Error(REASON), { code: BUDGET_UNAVAILABLE });
};

const isUnavailable = (error) => Boolean(error) && error.code === BUDGET_UNAVAILABLE;

const rethrow = (companyId, what) => (cause) => { throw unavailable(companyId, what, cause); };

module.exports = { BUDGET_UNAVAILABLE, REASON, unavailable, isUnavailable, rethrow };

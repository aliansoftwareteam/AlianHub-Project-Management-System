const logger = require('../../Config/loggerConfig');

const GENERIC = 'The tool could not finish, and nothing more can be said here. Try again later, or ask the person to tell their workspace admin.';

/* Errors a tool raises on purpose are written for the client: a JSON-RPC code, a not-visible refusal, an executor's
 * deterministic refusal, or a 4xx. Anything else may carry internal detail, which stays in the server log. */
const isMeantForClient = (error) => Boolean(error) && (
    error.notVisible === true
    || error.deterministic === true
    || (Number.isInteger(error.code) && error.code <= -32000 && error.code >= -32768)
    || [error.status, error.statusCode].some((status) => Number.isInteger(status) && status >= 400 && status < 500)
);

const clientMessage = (error, where) => {
    if (isMeantForClient(error)) return error.message;
    logger.error(`mcp ${where}: ${error && error.stack ? error.stack : error}`);
    return GENERIC;
};

module.exports = { GENERIC, isMeantForClient, clientMessage };

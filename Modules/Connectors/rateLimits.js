const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const backoff = require('../Integrations/appConnections/backoff');
const connections = require('./resolveConnection');

const FIRST_FAILURE = 1;
const RATE_WORDS = /rate.?limit/i;

/* Providers answer 403 for missing rights too, so a listed status other than 429 counts only when it says it is a rate limit. */
const isRateLimited = (definition, res) => {
    if (res.status === 429) return true;
    const listed = (definition.rateLimit && definition.rateLimit.statuses) || [];
    if (!listed.includes(res.status)) return false;
    return Boolean(res.headers && res.headers['retry-after']) || RATE_WORDS.test(String(res.body || ''));
};

const untilOf = (res, now = Date.now()) => {
    const headers = res.headers || {};
    return new Date(backoff.nextAttempt({ retry: { after: headers['retry-after'], reset: headers['x-ratelimit-reset'] } }, FIRST_FAILURE, now));
};

/* markBackoff arrives with task 066; until then no connection exists, so no call reaches this point outside tests. */
const hold = async (companyId, connectionId, res) => {
    const until = untilOf(res);
    if (connections.markBackoff) {
        await connections.markBackoff({ companyId: String(companyId), connectionId: String(connectionId), until })
            .catch((e) => logger.error(`connector backoff of ${connectionId} was not saved: ${(e && e.name) || 'Error'}`));
    }
    return until;
};

const heldUntil = async (companyId, connectionId, now = Date.now()) => {
    const row = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.CONNECTOR_CONNECTIONS, data: [{ _id: String(connectionId) }, { backoffUntil: 1 }] }, 'findOne');
    const until = row && row.backoffUntil ? new Date(row.backoffUntil) : null;
    return until && until.getTime() > now ? until : null;
};

module.exports = { isRateLimited, untilOf, hold, heldUntil };

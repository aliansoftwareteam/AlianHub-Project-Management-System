const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../../utils/commonFunctions');
const { hostMatches } = require('../../Agents/engine/egressRules');
const { connectionsChanged } = require('../helpers/connectionsChanged');
const { EGRESS_BLOCKED } = require('./backoff');

const T = SCHEMA_TYPE.INTEGRATION_CONNECTIONS;
const HTTPS_PORT = 443;
const CLEARED = Object.freeze({ errorCode: '', blockedHost: '', lastError: '', nextAttemptAt: null });

const admitted = (hosts, sync) => !!sync && sync.errorCode === EGRESS_BLOCKED && hostMatches(hosts, sync.blockedHost, HTTPS_PORT);

const fieldsAt = (prefix) => Object.fromEntries(Object.entries(CLEARED).map(([name, value]) => [[...prefix, name].join('.'), value]));

/* Once the list admits the host a sync was refused, the card stops saying so and the backoff is dropped,
 * so the next poll tries at once instead of hours later. A repository mapped to projects keeps its own state. */
async function clearAllowedRefusals(companyId, hosts) {
    const rows = await MongoDbCrudOpration(companyId, {
        type: T, data: [{ $or: [{ 'sync.errorCode': EGRESS_BLOCKED }, { 'repos.sync.errorCode': EGRESS_BLOCKED }], deletedStatusKey: { $ne: 1 } }],
    }, 'find');
    let cleared = 0;
    for (const row of rows || []) {
        const repos = (Array.isArray(row.repos) ? row.repos : []).filter((entry) => entry && admitted(hosts, entry.sync)).map((entry) => entry.repo);
        const own = admitted(hosts, row.sync);
        if (!own && !repos.length) continue;
        const $set = { ...(own ? fieldsAt(['sync']) : {}), ...(repos.length ? fieldsAt(['repos', '$[admitted]', 'sync']) : {}) };
        // eslint-disable-next-line no-await-in-loop
        await MongoDbCrudOpration(companyId, {
            type: T,
            data: [{ _id: row._id }, { $set }, { returnDocument: 'after', ...(repos.length ? { arrayFilters: [{ 'admitted.repo': { $in: repos } }] } : {}) }],
        }, 'findOneAndUpdate');
        connectionsChanged(companyId, row._id, { lastError: '' });
        cleared += 1;
    }
    if (cleared) removeCache(`integration_connections:${companyId}`);
    return cleared;
}

module.exports = { clearAllowedRefusals };

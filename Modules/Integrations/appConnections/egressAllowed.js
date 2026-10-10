const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../../utils/commonFunctions');
const { hostMatches } = require('../../Agents/engine/egressRules');
const { connectionsChanged } = require('../helpers/connectionsChanged');
const { EGRESS_BLOCKED } = require('./backoff');

const T = SCHEMA_TYPE.INTEGRATION_CONNECTIONS;
const HTTPS_PORT = 443;

/* Once the list admits the host a sync was refused, the card stops saying so and the backoff is dropped,
 * so the next poll tries at once instead of hours later. */
async function clearAllowedRefusals(companyId, hosts) {
    const rows = await MongoDbCrudOpration(companyId, {
        type: T, data: [{ 'sync.errorCode': EGRESS_BLOCKED, deletedStatusKey: { $ne: 1 } }],
    }, 'find');
    const cleared = (rows || []).filter((row) => hostMatches(hosts, (row.sync || {}).blockedHost, HTTPS_PORT));
    for (const row of cleared) {
        // eslint-disable-next-line no-await-in-loop
        await MongoDbCrudOpration(companyId, {
            type: T,
            data: [{ _id: row._id }, { $set: { 'sync.errorCode': '', 'sync.blockedHost': '', 'sync.lastError': '', 'sync.nextAttemptAt': null } }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        connectionsChanged(companyId, row._id, { lastError: '' });
    }
    if (cleared.length) removeCache(`integration_connections:${companyId}`);
    return cleared.length;
}

module.exports = { clearAllowedRefusals };

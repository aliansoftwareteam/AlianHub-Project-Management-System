const { myCache } = require('../../../Config/config');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');
const { recordAudit } = require('../../Audit/recorder');

const COLLECTION = SCHEMA_TYPE.EGRESS_ALLOWLISTS;
const DOC_ID = 'workspace';
const CACHE_PREFIX = 'egressAllowlist:';
const EMPTY_PREFIX = 'egressAllowlistEmpty:';
const CACHE_TTL_SECONDS = 30;
const REFUSED_ACTION = 'agent.egress_refused';

const cacheKey = (companyId) => `${CACHE_PREFIX}${companyId}`;
const emptyKey = (companyId) => `${EMPTY_PREFIX}${companyId}`;

/* Whether the list was empty the last time it was read or written. It outlives the list cache, so a failed
 * read can tell a workspace that never had a list from one that must stay closed. */
const rememberEmptiness = (companyId, hosts) => myCache.set(emptyKey(companyId), hosts.length === 0, 0);

const hostsOf = (doc) => (doc && Array.isArray(doc.hosts) ? doc.hosts.map(String) : []);

const readList = async (companyId) => MongoDbCrudOpration(String(companyId), { type: COLLECTION, data: [{ _id: DOC_ID }] }, 'findOne');

/* Read once per window, an empty list included. A read that fails refuses the fetch rather than making it
 * blind, unless the workspace was last known to have no list: then it fetches as it does without one. The
 * failure is not cached, so the next fetch reads again. */
const hostsFor = async (companyId) => {
    const key = cacheKey(companyId);
    const cached = myCache.get(key);
    if (cached !== undefined) return cached;
    let doc;
    try {
        doc = await readList(companyId);
    } catch (error) {
        logger.error(`egress allowlist: company ${companyId} unreadable: ${error.message || error}`);
        if (myCache.get(emptyKey(companyId)) === true) return [];
        throw new Error('the workspace egress allowlist could not be read, so the fetch was refused');
    }
    const hosts = hostsOf(doc);
    myCache.set(key, hosts, CACHE_TTL_SECONDS);
    rememberEmptiness(companyId, hosts);
    return hosts;
};

const invalidate = (companyId) => {
    if (companyId) myCache.del(cacheKey(String(companyId)));
};

const replaceHosts = async (companyId, hosts, updatedBy) => {
    const updatedAt = new Date();
    const list = [...hosts];
    await MongoDbCrudOpration(String(companyId), {
        type: COLLECTION,
        data: [{ _id: DOC_ID }, { $set: { hosts: list, updatedBy: String(updatedBy || ''), updatedAt } }, { upsert: true }],
    }, 'findOneAndUpdate');
    invalidate(companyId);
    rememberEmptiness(companyId, list);
    return { hosts: list, updatedBy: String(updatedBy || ''), updatedAt };
};

const refusedSince = async (companyId, since) => MongoDbCrudOpration(String(companyId), {
    type: SCHEMA_TYPE.AUDIT_LOGS,
    data: [{ action: REFUSED_ACTION, createdAt: { $gte: since } }],
}, 'countDocuments');

/* The host is the entity; a path or a query string would carry whatever the task text held. */
const recordRefusal = (companyId, { actor, host, port, reason, hop }) => recordAudit(companyId, {
    actorId: actor ? String(actor) : '',
    action: REFUSED_ACTION,
    entityType: 'host',
    entityId: host,
    entityName: host,
    meta: { reason, host, port, hop },
});

module.exports = { COLLECTION, DOC_ID, CACHE_TTL_SECONDS, REFUSED_ACTION, readList, hostsFor, invalidate, replaceHosts, refusedSince, recordRefusal };

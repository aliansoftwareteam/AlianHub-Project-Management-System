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

/* When this server last saw the list empty, by a read or its own write. A failed read within one cache window of
 * that fetches as without a list, which is no staler than a cached empty list would be; after it another server may
 * have added hosts, so the read refuses. */
const EMPTY_MEMORY_MS = CACHE_TTL_SECONDS * 1000;

// A monotonic clock, so setting the system clock can neither stretch the window nor cut it short.
const rememberEmptiness = (companyId, hosts) => {
    if (hosts.length) myCache.del(emptyKey(companyId));
    else myCache.set(emptyKey(companyId), performance.now(), 0);
};

const recentlyEmpty = (companyId) => {
    const at = myCache.get(emptyKey(companyId));
    return typeof at === 'number' && performance.now() - at <= EMPTY_MEMORY_MS;
};

const hostsOf = (doc) => (doc && Array.isArray(doc.hosts) ? doc.hosts.map(String) : []);

const readList = async (companyId) => MongoDbCrudOpration(String(companyId), { type: COLLECTION, data: [{ _id: DOC_ID }] }, 'findOne');

/* Read once per window, an empty list included. A read that fails refuses the fetch rather than making it
 * blind, unless the list was seen empty within the last window. The failure is not cached. */
const hostsFor = async (companyId) => {
    const key = cacheKey(companyId);
    const cached = myCache.get(key);
    if (cached !== undefined) return cached;
    let doc;
    try {
        doc = await readList(companyId);
    } catch (error) {
        logger.error(`egress allowlist: company ${companyId} unreadable: ${error.message || error}`);
        if (recentlyEmpty(companyId)) return [];
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

const versionOf = (doc) => (doc && Number.isInteger(doc.version) ? doc.version : 0);

// A list stored before versions has none, and counts as version 0.
const atVersion = (version) => (version === 0
    ? { _id: DOC_ID, $or: [{ version: { $exists: false } }, { version: 0 }] }
    : { _id: DOC_ID, version });

/* With `expectedVersion`, the write lands only on that version and answers null when another save got there first.
 * An upsert on version 0 that meets an existing list fails on the fixed _id, which is the same answer. */
const replaceHosts = async (companyId, hosts, updatedBy, expectedVersion) => {
    const updatedAt = new Date();
    const list = [...hosts];
    const by = String(updatedBy || '');
    const conditional = expectedVersion !== undefined;
    let doc;
    try {
        doc = await MongoDbCrudOpration(String(companyId), {
            type: COLLECTION,
            data: [
                conditional ? atVersion(expectedVersion) : { _id: DOC_ID },
                { $set: { hosts: list, updatedBy: by, updatedAt }, $inc: { version: 1 } },
                { upsert: !conditional || expectedVersion === 0, new: true },
            ],
        }, 'findOneAndUpdate');
    } catch (error) {
        if (!(conditional && error && error.code === 11000)) throw error;
        doc = null;
    }
    if (conditional && !doc) return null;
    invalidate(companyId);
    rememberEmptiness(companyId, list);
    return { hosts: list, updatedBy: by, updatedAt, version: versionOf(doc) };
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

module.exports = { COLLECTION, DOC_ID, CACHE_TTL_SECONDS, EMPTY_MEMORY_MS, REFUSED_ACTION, versionOf, readList, hostsFor, invalidate, replaceHosts, refusedSince, recordRefusal };

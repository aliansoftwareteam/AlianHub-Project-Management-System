const store = require('../../../Config/secrets');
const logger = require('../../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const R = require('./integrationsRules');

/* Where a connection's secret fields live: the store by handle when SECRETS_STORE is on, sealed into config
 * otherwise. A write leaves exactly one of the two on the document, so whichever was saved last is the one
 * that is read; a document holding both is refused rather than guessed at. */

const secretName = (item, field) => `${item.name}: ${field.label}`;

const refuseBadKey = () => {
    const cfg = store.config();
    if (cfg.requested && !cfg.keyValid) throw new store.SecretsStoreError('key_invalid', cfg.error);
    return cfg;
};

/* Answers the document write and the handles it leaves behind; the caller retires those once the write has landed. */
async function storeSecrets({ companyId, type, config, existing, actor }) {
    const cfg = refuseBadKey();
    const held = { ...((existing && existing.secretHandles) || {}) };
    if (!cfg.on) return { set: { config: R.sealConfig(type, config) }, unset: { secretHandles: '' }, stale: Object.values(held) };
    const item = R.byKey(type);
    const out = { ...config };
    const handles = { ...held };
    for (const field of (item.fields || []).filter((f) => f.secret)) {
        const value = out[field.key];
        if (value === undefined || value === null || value === '') continue;
        handles[field.key] = await keep({ companyId, handle: handles[field.key], name: secretName(item, field), value, actor });
        delete out[field.key];
    }
    return { set: { config: out, secretHandles: handles }, unset: null, stale: [] };
}

/* Rotate onto the document's existing handle; a revoked or missing one gets a fresh handle. */
async function keep({ companyId, handle, name, kind = 'integration', value, actor }) {
    if (handle) {
        try {
            return (await store.rotate({ companyId, handle, value, actor })).handle;
        } catch (error) {
            if (!['revoked', 'not_found'].includes(error.code)) throw error;
        }
    }
    return (await store.create({ companyId, name, kind, value, actor })).handle;
}

async function openSecrets({ companyId, row }) {
    const config = R.openConfig(row.type, row.config || {});
    const handles = row.secretHandles || {};
    for (const key of R.secretKeys(row.type)) {
        if (!handles[key]) continue;
        if (row.config && row.config[key]) {
            logger.error(`[secrets] integration connection ${row._id} holds both a handle and a sealed value for ${key}, so it reads as not configured; connect it again`);
            delete config[key];
            continue;
        }
        const value = await store.resolve({ companyId, handle: handles[key] }).catch(() => null);
        if (value) config[key] = value; else delete config[key];
    }
    return config;
}

async function retireSecrets({ companyId, handles, actor }) {
    for (const handle of handles || []) await store.retire({ companyId, handle, actor });
}

const revokeSecrets = ({ companyId, row, actor }) => retireSecrets({ companyId, handles: Object.values((row && row.secretHandles) || {}), actor });

/* The catalogue field a stored secret belongs to, read from the live connection that holds its handle. */
async function fieldOfHandle({ companyId, handle }) {
    const rows = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.INTEGRATION_CONNECTIONS, data: [{ deletedStatusKey: { $ne: 1 } }, { type: 1, secretHandles: 1 }] }, 'find') || [];
    for (const row of rows) {
        const hit = Object.entries(row.secretHandles || {}).find(([, held]) => held === handle);
        if (hit) return { type: row.type, key: hit[0] };
    }
    return null;
}

module.exports = { storeSecrets, openSecrets, retireSecrets, revokeSecrets, fieldOfHandle, keep, secretName };

const store = require('../../../Config/secrets');
const R = require('./integrationsRules');

/* Where a connection's secret fields live: the store by handle when SECRETS_STORE is on, sealed into
 * config otherwise. Reads resolve a handle and fall back to the sealed field when there is none. */

const secretName = (item, field) => `${item.name}: ${field.label}`;

async function storeSecrets({ companyId, type, config, existing, actor }) {
    if (!store.isOn()) return { config: R.sealConfig(type, config) };
    const item = R.byKey(type);
    const out = { ...config };
    const handles = { ...((existing && existing.secretHandles) || {}) };
    for (const field of (item.fields || []).filter((f) => f.secret)) {
        const value = out[field.key];
        if (value === undefined || value === null || value === '') continue;
        handles[field.key] = await keep({ companyId, handle: handles[field.key], name: secretName(item, field), value, actor });
        delete out[field.key];
    }
    return { config: out, secretHandles: handles };
}

/* Rotate onto the connection's existing handle; a revoked or missing one gets a fresh handle. */
async function keep({ companyId, handle, name, value, actor }) {
    if (handle) {
        try {
            return (await store.rotate({ companyId, handle, value, actor })).handle;
        } catch (error) {
            if (!['revoked', 'not_found'].includes(error.code)) throw error;
        }
    }
    return (await store.create({ companyId, name, kind: 'integration', value, actor })).handle;
}

async function openSecrets({ companyId, row }) {
    const config = R.openConfig(row.type, row.config || {});
    const handles = row.secretHandles || {};
    for (const key of R.secretKeys(row.type)) {
        if (!handles[key]) continue;
        const value = await store.resolve({ companyId, handle: handles[key] }).catch(() => null);
        if (value) config[key] = value; else delete config[key];
    }
    return config;
}

async function revokeSecrets({ companyId, row, actor }) {
    for (const handle of Object.values((row && row.secretHandles) || {})) {
        await store.revoke({ companyId, handle, actor }).catch((error) => {
            if (!['revoked', 'not_found', 'store_off'].includes(error.code)) throw error;
        });
    }
}

module.exports = { storeSecrets, openSecrets, revokeSecrets, secretName };

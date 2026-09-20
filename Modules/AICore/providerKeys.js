const mongoose = require('mongoose');
const { dbCollections } = require('../../Config/collections');
const config = require('../../Config/config');
const logger = require('../../Config/loggerConfig');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const store = require('../../Config/secrets');
const providerContext = require('./providerContext');

const COMPANY_FIELD = 'aiProviderKeys';
const SECRET_KIND = 'provider';
const LOG = '[provider-keys]';

/* Read late: the adapters require this module, so requiring the registry at load would hand back its unfinished exports. */
const providerNames = () => require('./llmProvider/registry').PROVIDER_NAMES;

/* The instance key each adapter reads today; the workspace key replaces exactly this read. */
const instanceKeyOf = (provider) => {
    switch (provider) {
        case 'openai': return config.AI_API_KEY || '';
        case 'anthropic': return process.env.ANTHROPIC_API_KEY || '';
        case 'deepseek': return config.DEEPSEEK_API_KEY || '';
        case 'google': return process.env.GOOGLE_API_KEY || '';
        default: return '';
    }
};

const providerNameOf = (value) => {
    const name = String(value || '').trim().toLowerCase();
    return providerNames().includes(name) ? name : '';
};

const invalid = (message) => new store.SecretsStoreError('invalid_input', message);

/* Effective only with the flag on over a working secrets store: with anything
 * missing every read below answers the instance key and no mapping is touched. */
const isOn = () => {
    if (!providerContext.flagOn()) return false;
    const cfg = store.config();
    return cfg.requested && cfg.keyValid;
};

const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

const readMapping = async (companyId) => {
    const company = await MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: dbCollections.COMPANIES, data: [{ _id: oid(companyId) }, COMPANY_FIELD],
    }, 'findOne');
    const mapping = company && company[COMPANY_FIELD];
    return mapping && typeof mapping === 'object' && !Array.isArray(mapping) ? mapping : {};
};

const writeMapping = async (companyId, mapping) => {
    const written = await MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: dbCollections.COMPANIES, data: [{ _id: oid(companyId) }, { $set: { [COMPANY_FIELD]: mapping } }],
    }, 'updateOne');
    if (!written || written.matchedCount < 1) throw new store.SecretsStoreError('not_found', 'No such workspace.');
    removeCache(`companyData_${companyId}`);
};

const labelOf = (provider) => `${provider.charAt(0).toUpperCase()}${provider.slice(1)} API key`;

/* The key a call for this workspace and provider is billed to: the workspace's
 * own when one is set, the instance key otherwise. A set key that will not
 * resolve refuses rather than billing the instance owner by surprise. */
async function apiKeyFor(provider, companyId = null) {
    const name = providerNameOf(provider);
    const instanceKey = name ? instanceKeyOf(name) : '';
    const id = companyId || providerContext.companyIdOf();
    if (!name || !isOn() || !id) return instanceKey || null;
    let mapping;
    try {
        mapping = await readMapping(id);
    } catch (error) {
        logger.error(`${LOG} company ${id} mapping unreadable: ${error.message || error}`);
        throw new store.SecretsStoreError('key_invalid', `The ${name} key for this workspace could not be read, so the call was refused.`);
    }
    const handle = mapping[name];
    if (!handle) return instanceKey || null;
    const value = await store.resolve({ companyId: id, handle });
    if (value) return value;
    let code = 'key_invalid';
    try {
        await store.describe({ companyId: id, handle });
    } catch (error) {
        if (['revoked', 'not_found'].includes(error.code)) code = error.code;
    }
    throw new store.SecretsStoreError(code, `The stored ${name} key for this workspace will not open, so the call was refused. Set it again under Settings.`);
}

async function setKey({ companyId, provider, value, actor }) {
    const name = providerNameOf(provider);
    if (!name) throw invalid(`Unknown provider "${String(provider)}": one of ${providerNames().join(', ')}.`);
    const cfg = store.config();
    if (!cfg.requested) throw new store.SecretsStoreError('store_off', 'The secrets store is off (SECRETS_STORE).');
    if (!cfg.keyValid) throw new store.SecretsStoreError('key_invalid', cfg.error);
    const id = providerContext.companyIdOf({ companyId });
    if (!id) throw invalid('A workspace id is required.');
    const mapping = await readMapping(id);
    const handle = mapping[name];
    let kept = null;
    let fresh = false;
    if (handle) {
        try {
            kept = (await store.rotate({ companyId: id, handle, value, actor })).handle;
        } catch (error) {
            if (!['revoked', 'not_found'].includes(error.code)) throw error;
        }
    }
    if (!kept) {
        kept = (await store.create({ companyId: id, name: labelOf(name), kind: SECRET_KIND, value, actor })).handle;
        fresh = true;
    }
    try {
        await writeMapping(id, { ...mapping, [name]: kept });
    } catch (error) {
        if (fresh) await store.retire({ companyId: id, handle: kept, actor }).catch(() => {});
        throw error;
    }
    return describeKey({ companyId: id, provider: name });
}

async function clearKey({ companyId, provider, actor }) {
    const name = providerNameOf(provider);
    if (!name) throw invalid(`Unknown provider "${String(provider)}": one of ${providerNames().join(', ')}.`);
    const id = providerContext.companyIdOf({ companyId });
    if (!id) throw invalid('A workspace id is required.');
    const mapping = await readMapping(id);
    const handle = mapping[name];
    if (!handle) return { provider: name, set: false };
    await store.retire({ companyId: id, handle, actor });
    const next = { ...mapping };
    delete next[name];
    await writeMapping(id, next);
    return { provider: name, set: false };
}

async function describeKey({ companyId, provider }) {
    const name = providerNameOf(provider);
    const mapping = await readMapping(companyId);
    const handle = name ? mapping[name] : null;
    if (!handle) return { provider: name || String(provider), set: false };
    try {
        const meta = await store.describe({ companyId, handle });
        return { provider: name, set: true, keyId: meta.keyId, createdAt: meta.createdAt, rotatedAt: meta.rotatedAt, lastResolvedAt: meta.lastResolvedAt };
    } catch (error) {
        if (['revoked', 'not_found'].includes(error.code)) return { provider: name, set: false, stale: true };
        throw error;
    }
}

async function listKeys({ companyId }) {
    const id = providerContext.companyIdOf({ companyId });
    if (!id) throw invalid('A workspace id is required.');
    return Promise.all(providerNames().map((provider) => describeKey({ companyId: id, provider })));
}

module.exports = { COMPANY_FIELD, SECRET_KIND, providerNames, providerNameOf, instanceKeyOf, isOn, apiKeyFor, setKey, clearKey, describeKey, listKeys };

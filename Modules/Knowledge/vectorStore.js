const logger = require('../../Config/loggerConfig');
const { assertAdapter } = require('./adapters/contract');
const { createDatabaseVectorAdapter } = require('./adapters/vector');
const { createAtlasVectorAdapter } = require('./adapters/atlas');

// Where vectors are searched and told about writes. KNOWLEDGE_VECTOR_STORE picks it: "local", the
// default, scores the chunk rows in the tenant database and needs nothing more; "atlas" searches
// them with Atlas Vector Search, for hosted deployments. Tests swap in the in-memory adapter.

const BACKENDS = ['local', 'atlas'];

let active = null;

const backend = () => {
    const wanted = String(process.env.KNOWLEDGE_VECTOR_STORE || 'local').trim().toLowerCase();
    if (BACKENDS.includes(wanted)) return wanted;
    logger.warn(`knowledge: KNOWLEDGE_VECTOR_STORE "${wanted}" is not one of ${BACKENDS.join(', ')}; using local`);
    return 'local';
};

const current = () => {
    if (!active) active = backend() === 'atlas' ? createAtlasVectorAdapter() : createDatabaseVectorAdapter();
    return active;
};

const use = (adapter) => {
    active = assertAdapter(adapter);
    return active;
};

const reset = () => { active = null; };

/* Readies a tenant for the store (the Atlas index) without the caller waiting on it or failing
 * with it: tenant creation and the recurring job call this. */
const prepareCompany = (companyId) => {
    try {
        const store = current();
        if (typeof store.prepare !== 'function') return Promise.resolve(null);
        return Promise.resolve(store.prepare({ companyId: String(companyId) })).catch((error) => {
            logger.error(`knowledge: preparing the vector store for ${companyId} failed: ${error.message}`);
            return null;
        });
    } catch (error) {
        logger.error(`knowledge: preparing the vector store for ${companyId} failed: ${error.message}`);
        return Promise.resolve(null);
    }
};

/* What the console shows of the store for one tenant. */
const health = async (companyId, { refresh = false } = {}) => {
    const store = current();
    if (typeof store.health !== 'function') return { backend: 'local', index: null, breaker: null };
    try {
        return await store.health({ companyId: String(companyId), refresh });
    } catch (error) {
        logger.error(`knowledge: reading the vector store health for ${companyId} failed: ${error.message}`);
        return { backend: 'atlas', index: { status: 'unknown' }, breaker: null };
    }
};

module.exports = { BACKENDS, backend, current, use, reset, prepareCompany, health };

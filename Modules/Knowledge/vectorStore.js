const logger = require('../../Config/loggerConfig');
const flag = require('./flag');
const { assertAdapter } = require('./adapters/contract');
const { createDatabaseVectorAdapter } = require('./adapters/vector');
const { createAtlasVectorAdapter } = require('./adapters/atlas');

// Where vectors are searched and told about writes. KNOWLEDGE_VECTOR_STORE picks it: "local", the
// default, scores the chunk rows in the tenant database and needs nothing more; "atlas" searches
// them with Atlas Vector Search, for hosted deployments. Tests swap in the in-memory adapter.

const BACKENDS = ['local', 'atlas'];
const PREPARE_CONCURRENCY = 4;
const DEFAULT_PREPARE_BUDGET_MS = 30000;

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

/* Readies a tenant whose retrieval uses vectors (the Atlas index), without the caller failing
 * with it: tenant creation and the recurring job call this. A tenant that switches to hybrid later
 * is readied by the job's next run. */
const prepareCompany = async (companyId) => {
    try {
        const store = current();
        if (typeof store.prepare !== 'function') return null;
        if (!(await flag.hybridFor(String(companyId)))) return null;
        return await store.prepare({ companyId: String(companyId) });
    } catch (error) {
        logger.error(`knowledge: preparing the vector store for ${companyId} failed: ${error.message}`);
        return null;
    }
};

const budgetMs = () => {
    const ms = Math.floor(Number(process.env.KNOWLEDGE_ATLAS_INDEX_BUDGET_MS));
    return Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_PREPARE_BUDGET_MS;
};

const withinBudget = (companyId, ms) => {
    let timer;
    const late = new Promise((resolve) => {
        timer = setTimeout(() => {
            logger.warn(`knowledge: the vector index check for ${companyId} took longer than ${ms} ms; the next run tries again`);
            resolve(null);
        }, ms);
        if (timer.unref) timer.unref();
    });
    return Promise.race([prepareCompany(companyId), late]).finally(() => clearTimeout(timer));
};

/* A few tenants at a time, each within a budget, so one slow tenant cannot hold up the rest. */
const prepareCompanies = async (companyIds) => {
    if (typeof current().prepare !== 'function') return;
    const queue = [...companyIds];
    const ms = budgetMs();
    const worker = async () => {
        while (queue.length) await withinBudget(queue.shift(), ms);
    };
    await Promise.all(Array.from({ length: Math.min(PREPARE_CONCURRENCY, queue.length) }, worker));
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

module.exports = { BACKENDS, PREPARE_CONCURRENCY, backend, current, use, reset, prepareCompany, prepareCompanies, health };

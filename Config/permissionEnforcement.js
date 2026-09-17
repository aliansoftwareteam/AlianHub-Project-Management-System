const mongoose = require('mongoose');
const { myCache } = require('./config');
const { dbCollections } = require('./collections');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const logger = require('./loggerConfig');

const OFF = 'off';
const REPORT = 'report';
const ENFORCE = 'enforce';
const MODES = [OFF, REPORT, ENFORCE];
const COMPANY_FIELD = 'permissionEnforcement';
const INHERIT = 'inherit';
const CACHE_PREFIX = 'permissionEnforcement:';
const DEFAULT_CACHE_TTL_SECONDS = 30;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const asMode = (raw) => {
    if (raw === undefined || raw === null || typeof raw === 'object') return null;
    const value = String(raw).trim().toLowerCase();
    return MODES.includes(value) ? value : null;
};

const instanceMode = () => asMode(process.env.PERMISSION_ENFORCEMENT_MODE) || OFF;

/* Until the enforcement console writes it, the row is edited by hand, so a mode may arrive as a bare
 * string or as { mode } in any case. Anything else inherits: a typo never picks a mode of its own. */
const normaliseCompanyMode = (stored) => asMode(stored !== null && typeof stored === 'object' ? stored.mode : stored);

const cacheTtlSeconds = () => {
    const raw = String(process.env.PERMISSION_ENFORCEMENT_CACHE_TTL_SECONDS ?? '').trim();
    const seconds = Number(raw);
    return raw !== '' && Number.isFinite(seconds) && seconds >= 0 ? seconds : DEFAULT_CACHE_TTL_SECONDS;
};

const cacheKey = (companyId) => `${CACHE_PREFIX}${companyId}`;

/* A row that cannot be read inherits and is not cached, so the next request asks again. */
const companyMode = async (companyId) => {
    const cached = myCache.get(cacheKey(companyId));
    if (cached !== undefined) return cached === INHERIT ? null : cached;
    try {
        const company = await MongoDbCrudOpration(dbCollections.GLOBAL, {
            type: dbCollections.COMPANIES,
            data: [{ _id: new mongoose.Types.ObjectId(companyId) }, { [COMPANY_FIELD]: 1 }],
        }, 'findOne');
        const own = normaliseCompanyMode(company && company[COMPANY_FIELD]);
        const ttl = cacheTtlSeconds();
        // node-cache keeps a value set with a TTL of 0 forever.
        if (ttl > 0) myCache.set(cacheKey(companyId), own || INHERIT, ttl);
        return own;
    } catch (error) {
        logger.error(`permission enforcement: company ${companyId}: ${error.message || error}`);
        return null;
    }
};

const killSwitchOn = () => process.env.DISABLE_PERMISSION_ENFORCEMENT === 'true';

/* off | report | enforce for a browser session in this workspace. Never throws. */
const resolveMode = async (companyId) => {
    const id = String(companyId || '');
    let mode;
    try {
        mode = (OBJECT_ID.test(id) && await companyMode(id)) || instanceMode();
    } catch (error) {
        logger.error(`permission enforcement: resolving ${id}: ${error.message || error}`);
        mode = instanceMode();
    }
    return mode === ENFORCE && killSwitchOn() ? REPORT : mode;
};

const invalidateEnforcementMode = (companyId) => {
    if (companyId) myCache.del(cacheKey(String(companyId)));
};

module.exports = {
    OFF,
    REPORT,
    ENFORCE,
    MODES,
    COMPANY_FIELD,
    DEFAULT_CACHE_TTL_SECONDS,
    instanceMode,
    normaliseCompanyMode,
    cacheTtlSeconds,
    resolveMode,
    invalidateEnforcementMode,
};

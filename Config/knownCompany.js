const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('./schemaType');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { myCache } = require('./config');
const { isRetiring } = require('../middlewares/mongoConnector/retiring');
const logger = require('./loggerConfig');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const CACHE_PREFIX = 'knownCompany:';
const CACHE_TTL_SECONDS = 300;

/* Asked by routes that take a company id before anyone signs in, since reading a company's
 * database opens a pooled connection to it. The global database answers; its connection is always
 * open. Only a hit is cached so a new company is found at once, and deleting a company clears
 * every cache key that names it. */
const isKnownCompany = async (companyId) => {
    const id = String(companyId || '');
    if (!OBJECT_ID.test(id) || isRetiring(id)) return false;
    const cacheKey = `${CACHE_PREFIX}${id}`;
    if (myCache.get(cacheKey) === true) return true;
    try {
        const company = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
            type: SCHEMA_TYPE.COMPANIES,
            data: [{ _id: new mongoose.Types.ObjectId(id), deletingAt: { $exists: false } }, { _id: 1 }],
        }, 'findOne');
        if (!company) return false;
        myCache.set(cacheKey, true, CACHE_TTL_SECONDS);
        return true;
    } catch (error) {
        logger.error(`isKnownCompany ${id}: ${error.message}`);
        return false;
    }
};

module.exports = { isKnownCompany };

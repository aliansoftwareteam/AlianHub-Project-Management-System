const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const importData = require('../../utils/data');

const cacheKey = (companyId, userId) => `notification:${userId}:${companyId}`;

/* Upserts the per-user notification settings document. Safe to call more than
   once: company creation, a company switch and the first read of the settings
   page all go through here. Resolves with the document. */
exports.ensureNotificationDefaults = async (companyId, userId) => {
    if (!companyId || !userId) throw new Error('companyId and userId are required');
    const query = { type: SCHEMA_TYPE.NOTIFICATIONS_SETTINGS, data: [{ userId: String(userId) }] };
    const existing = await MongoDbCrudOpration(companyId, query, 'findOne');
    if (existing) return existing;
    await importData.importUserNotifications(companyId, String(userId));
    removeCache(cacheKey(companyId, userId));
    return MongoDbCrudOpration(companyId, query, 'findOne');
};

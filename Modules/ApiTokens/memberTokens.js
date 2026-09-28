const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');

/* Deactivated rather than deleted so the token's activity log still says who called what. */
const revokeMemberTokens = async (companyId, userId) => {
    if (!companyId || !userId) return 0;
    try {
        const result = await MongoDbCrudOpration(String(companyId), {
            type: SCHEMA_TYPE.API_TOKENS,
            data: [{ userId: String(userId), active: true }, { $set: { active: false } }],
        }, 'updateMany');
        return (result && (result.modifiedCount || result.nModified)) || 0;
    } catch (error) {
        logger.error(`revokeMemberTokens ${companyId}/${userId}: ${error.message}`);
        return 0;
    }
};

module.exports = { revokeMemberTokens };

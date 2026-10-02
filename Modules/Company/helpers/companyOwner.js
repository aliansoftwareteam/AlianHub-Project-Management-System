const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { ROLE_OWNER } = require('../../../Config/roleTypes');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');

/* The user id of the company's owner, or '' when it cannot be read. */
const companyOwnerOf = async (companyId) => {
    const owner = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [{ roleType: ROLE_OWNER, isDelete: { $ne: true } }, { userId: 1 }],
    }, 'findOne').catch(() => null);
    return owner && owner.userId ? String(owner.userId) : '';
};

module.exports = { companyOwnerOf };

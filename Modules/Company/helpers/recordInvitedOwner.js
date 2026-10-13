const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../../utils/commonFunctions');
const { ROLE_OWNER } = require('../../../Config/roleTypes');
const { OBJECT_ID_PATTERN } = require('./companyAccessRules');

/* An invitation that carries the owner role is what hands a company over, so the handler that
 * verified the invitation records the new owner itself. The alternative — a second call from the
 * browser saying "I am the owner now" — is a claim the server would have to re-verify anyway. */
exports.recordInvitedOwner = async ({ companyId, invitation, userId }) => {
    if (!invitation || Number(invitation.roleType) !== ROLE_OWNER) return false;
    if (!OBJECT_ID_PATTERN.test(String(companyId || '')) || !OBJECT_ID_PATTERN.test(String(userId || ''))) return false;

    await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
        type: SCHEMA_TYPE.COMPANIES,
        data: [
            { _id: new mongoose.Types.ObjectId(String(companyId)) },
            { $set: { userId: new mongoose.Types.ObjectId(String(userId)) } }
        ]
    }, 'findOneAndUpdate');

    removeCache(`companyData_${companyId}`, true);
    return true;
};

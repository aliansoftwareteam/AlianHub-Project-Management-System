const mongoose = require("mongoose");
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { dbCollections } = require("../../Config/collections");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { addAndRemoveUserInMongodbNotificationCount } = require("../Auth/controller/authHelpers");
const logger = require("../../Config/loggerConfig");

// SEC-02 — Just-In-Time provision (or link) an SSO user into a company. Mirrors
// the OAuth signup path (createUser.googleSignup): global userAuth + users,
// then per-company company_users membership + notification defaults. Returns uid.
const jitProvisionUser = async ({ companyId, email, firstName, lastName, externalId, defaultRoleType = 3, autoProvision = true }) => {
    const normEmail = String(email || '').trim().toLowerCase();
    if (!companyId || !normEmail) throw new Error('companyId and email are required');

    let userAuth = await MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: dbCollections.USER_AUTH, data: [{ email: normEmail }],
    }, 'findOne');

    let uid;
    if (userAuth) {
        uid = userAuth._id;
        await MongoDbCrudOpration(dbCollections.GLOBAL, {
            type: SCHEMA_TYPE.USERS,
            data: [{ _id: new mongoose.Types.ObjectId(String(uid)) }, { $addToSet: { AssignCompany: String(companyId) } }],
        }, 'updateOne');
    } else {
        if (!autoProvision) {
            const e = new Error('User is not provisioned and auto-provisioning is disabled for this workspace.');
            e.code = 'NO_AUTOPROVISION';
            throw e;
        }
        userAuth = await MongoDbCrudOpration(dbCollections.GLOBAL, {
            type: dbCollections.USER_AUTH, data: { email: normEmail, ssoExternalId: externalId || '', isBlocked: false },
        }, 'save');
        uid = userAuth._id;
        await MongoDbCrudOpration(dbCollections.GLOBAL, {
            type: SCHEMA_TYPE.USERS,
            data: {
                _id: userAuth._id,
                AssignCompany: [String(companyId)],
                Employee_FName: firstName || normEmail.split('@')[0],
                Employee_LName: lastName || '-',
                Employee_Email: normEmail,
                Employee_Name: `${firstName || normEmail.split('@')[0]} ${lastName || ''}`.trim(),
                Time_Format: '12',
                isDeleted: false, isActive: true, isOnline: false, isEmailVerified: true,
            },
        }, 'save');
    }

    // Company membership.
    const existingMember = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS, data: [{ userId: String(uid) }],
    }, 'findOne');
    if (!existingMember) {
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: { userId: String(uid), roleType: Number(defaultRoleType) || 3, status: 1, userEmail: normEmail },
        }, 'save');
        await addAndRemoveUserInMongodbNotificationCount(companyId, uid, 'add')
            .catch((e) => logger.error(`SSO JIT notif add: ${e.message || e}`));
    }
    return String(uid);
};

module.exports = { jitProvisionUser };

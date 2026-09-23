const mongoose = require("mongoose");
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { dbCollections } = require("../../Config/collections");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { addAndRemoveUserInMongodbNotificationCount } = require("../Auth/controller/authHelpers");
const logger = require("../../Config/loggerConfig");
const { SEAT_ACTIVE } = require('../../Config/seatStatus');
const { domainOfEmail, isVerifiedDomain } = require('./helpers/ssoRules');

const SSO_NOT_ALLOWED = 'SSO_NOT_ALLOWED';

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
            data: {
                companyId: String(companyId), userId: String(uid), roleType: Number(defaultRoleType) || 3,
                status: SEAT_ACTIVE, isDelete: false, designation: 0, userEmail: normEmail,
            },
        }, 'save');
        await addAndRemoveUserInMongodbNotificationCount(companyId, uid, 'add')
            .catch((e) => logger.error(`SSO JIT notif add: ${e.message || e}`));
    }
    return String(uid);
};

const holdsSeat = (row) => Boolean(row) && Number(row.status) === SEAT_ACTIVE && row.isDelete !== true;

/* The IdP is configured by the company, so what it asserts decides only this company's own people:
 * accounts that already hold a seat here, and addresses on a domain the company proved it controls.
 * One refusal for every other case, so the answer never tells whether an account exists. */
const ssoSignInUser = async ({ companyId, cfg, identity }) => {
    const email = String((identity && identity.email) || '').trim().toLowerCase();
    if (!companyId || !cfg || !email) throw new Error('companyId, config and email are required');

    const auth = await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.USER_AUTH, data: [{ email }] }, 'findOne');
    const uid = auth ? String(auth._id) : '';
    const seat = (uid && await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMPANY_USERS, data: [{ userId: uid }] }, 'findOne'))
        || await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMPANY_USERS, data: [{ userEmail: email }] }, 'findOne');

    if (uid && seat && String(seat.userId) === uid && holdsSeat(seat)) return uid;

    const mayProvision = !seat && cfg.autoProvisionUsers !== false && isVerifiedDomain(cfg, domainOfEmail(email));
    if (!mayProvision) {
        try {
            require('../Audit/recorder').recordAudit(String(companyId), {
                action: 'sso.login_refused', entityType: 'sso', entityName: email, meta: { provider: cfg.provider },
            });
        } catch (e) { /* audit is best-effort */ }
        const refused = new Error('This account cannot sign in to this workspace with SSO.');
        refused.code = SSO_NOT_ALLOWED;
        throw refused;
    }

    return jitProvisionUser({
        companyId,
        email,
        firstName: identity.firstName,
        lastName: identity.lastName,
        externalId: identity.externalId,
        defaultRoleType: cfg.defaultRoleType,
    });
};

module.exports = { jitProvisionUser, ssoSignInUser, SSO_NOT_ALLOWED };

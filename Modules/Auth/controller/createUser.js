const logger = require("../../../Config/loggerConfig");
const mongoRef = require('../../../utils/mongo-handler/mongoQueries');
const sendMailRef = require("./sendVerificationMail")
const { dbCollections } = require('../../../Config/collections');
const ctr = require("../controller");
const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const mongoose = require("mongoose");
const { importUserNotifications } = require("../../../utils/data");
const { addAndRemoveUserInMongodbNotificationCount } = require("../../Auth/controller");
const { toAuthView } = require("../../Users/helpers/userAccessRules");
const { recordInvitedOwner } = require("../../Company/helpers/recordInvitedOwner");
const {
    SocialSignInRefusal,
    assertClaimedEmail,
    findAuth,
    findAuthByProviderId,
    noVerifiedEmail,
    verifySocialIdentity,
} = require("../helpers/socialIdentity");
const { linkTokenAccepted } = require("./invitationPreview");


exports.authenticateToken = "";

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const PENDING_INVITATION = 1;
const ACCEPTED_INVITATION = 2;

/* The body's assignCompany used to be taken on trust, which let anyone sign up straight
 * into any company. A company admits only an email it has a pending invitation row for. */
exports.findPendingInvitation = async ({ companyId, email, companyUserId }) => {
    if (!OBJECT_ID_PATTERN.test(String(companyId || '')) || !email) return null;
    const filter = { userEmail: String(email).trim().toLowerCase(), status: PENDING_INVITATION, isDelete: { $ne: true } };
    if (companyUserId !== undefined) {
        if (!OBJECT_ID_PATTERN.test(String(companyUserId || ''))) return null;
        filter._id = new mongoose.Types.ObjectId(String(companyUserId));
    }
    return mongoRef.MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.COMPANY_USERS, data: [filter] }, 'findOne').catch(() => null);
};

/* Signing up from an invitation needs the invitation id and secret token the link carries,
 * not only the invited address: that is what marks the address verified. */
exports.admitInvitee = async (body) => {
    const { memberId, linkId, ...registrant } = body;
    if (!registrant.assignCompany && !registrant.isInvitation) return { ...registrant, isInvitation: false };
    const invitation = memberId
        ? await exports.findPendingInvitation({ companyId: registrant.assignCompany, email: registrant.email, companyUserId: memberId })
        : null;
    return invitation && linkTokenAccepted(invitation.linkId, linkId)
        ? { ...registrant, isInvitation: true }
        : { ...registrant, assignCompany: '', isInvitation: false };
};


const REGISTRANT_FIELDS = ['firstName', 'lastName', 'email', 'password', 'assignCompany', 'isInvitation', 'memberId', 'linkId'];
const REQUIRED_SIGNUP_FIELDS = [['firstName', 'First Name'], ['lastName', 'Last Name'], ['email', 'Email'], ['password', 'Password']];

/* A signup never copies ownership, verification, billing or token fields from the request:
 * isProductOwner alone opens the Instance console. Setup grants it in its own update. */
exports.registrantFields = (body) => REGISTRANT_FIELDS.reduce((picked, field) => {
    if (body && Object.prototype.hasOwnProperty.call(body, field)) picked[field] = body[field];
    return picked;
}, {});

exports.buildUserDocument = ({ firstName, lastName, email, assignCompany, isInvitation }) => ({
    AssignCompany: assignCompany ? [assignCompany] : [],
    Employee_FName: firstName,
    Employee_LName: lastName,
    Employee_Email: email,
    Employee_Name: `${firstName} ${lastName}`,
    Time_Format: "12",
    isDeleted: false,
    isActive: true,
    isOnline: false,
    isEmailVerified: Boolean(isInvitation),
});

exports.addUserMongodbV2 = (data) => new Promise((resolve, reject) => {
    const object = { type: dbCollections.USERS, data: exports.buildUserDocument(data) };
    ctr.insertAuthFun({ email: data.email, password: data.password }, (iUserRes) => {
        if (!iUserRes.status) return reject(iUserRes.message);
        object.data._id = iUserRes.data._id;
        mongoRef.MongoDbCrudOpration(dbCollections.GLOBAL, object, 'save')
            .then((res) => resolve({ status: true, statusText: toAuthView(res) }))
            .catch(reject);
    });
});

const isFilledString = (value) => typeof value === 'string' && value.trim() !== '';

exports.createUserV2 = (req, res) => {
    try {
        const registrant = exports.registrantFields(req.body);
        const missing = REQUIRED_SIGNUP_FIELDS.find(([field]) => !isFilledString(registrant[field]));
        if (missing) {
            return res.send({ status: false, statusText: `${missing[1]} is required` });
        }
        let admitted = registrant;
        exports.admitInvitee(registrant).then((body) => {
            admitted = body;
            return exports.addUserMongodbV2(body);
        }).then((respo) => {
            if (!admitted.isInvitation) {
                sendMailRef.sendVerificationEmailPromise(respo.statusText._id, respo.statusText.Employee_Email).catch((error) => {
                    logger.error(error.statusText);
                });
            }
            res.send(respo);
        }).catch((error) => {
            res.send({
                status: false,
                statusText: error
            });
        });
    } catch (error) {
        res.send({
            status: false,
            statusText: `Error: ${error}`
        });
    }
}

exports.verifyToken = (req, res) => {
    res.json({
        status: true,
        key: 1
    });
};

const joinInvitedCompany = async ({ companyId, invitation, userId, provider }) => {
    const claimed = await mongoRef.MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [
            { _id: invitation._id, status: PENDING_INVITATION, linkId: invitation.linkId },
            { $set: { status: ACCEPTED_INVITATION, linkId: '', userId } },
        ],
    }, 'findOneAndUpdate');
    if (!claimed) return false;
    await recordInvitedOwner({ companyId, invitation, userId }).catch((error) => {
        logger.error(`Record invited owner error in ${provider} signup: ${error}`);
    });
    await importUserNotifications(companyId, userId).catch((error) => {
        logger.error(`Import notification setting error in ${provider} signup: ${error}`);
    });
    await addAndRemoveUserInMongodbNotificationCount(companyId, userId, 'Add').catch((error) => {
        logger.error(`Add user in mongodb notification count error in ${provider} signup: ${error}`);
    });
    return true;
};

/* The account's email is the one the provider verified, which is also the only reason it starts
 * verified. An invitation admits the account only when the signup presents that invitation row
 * and the link token it was sent with; otherwise the account is made as for anyone uninvited. */
const socialSignup = (provider) => async (req, res) => {
    const body = req.body || {};
    const refuse = (statusCode, message) => res.status(statusCode).json({ status: false, message });
    try {
        const { firstName, lastName, assignCompany, companyUserDocID, linkId } = body;
        if (!isFilledString(firstName) || !isFilledString(lastName)) {
            return refuse(400, 'First name and last name are required');
        }

        const identity = await verifySocialIdentity(provider, body);
        if (!identity.email) return refuse(401, noVerifiedEmail(identity));
        assertClaimedEmail(identity, body.email);
        const { email, idField, providerId, label } = identity;

        if (await findAuthByProviderId(identity)) {
            return refuse(409, `This ${label} account is already linked to an account. Sign in instead.`);
        }
        if (await findAuth({ email })) {
            return refuse(409, 'Email already exists');
        }

        const invitation = assignCompany && companyUserDocID
            ? await exports.findPendingInvitation({ companyId: assignCompany, email, companyUserId: companyUserDocID })
            : null;
        const presented = invitation && linkTokenAccepted(invitation.linkId, linkId) ? invitation : null;

        const authRes = await mongoRef.MongoDbCrudOpration(dbCollections.GLOBAL, {
            type: dbCollections.USER_AUTH,
            data: { email, [idField]: providerId, isBlocked: false },
        }, 'save');

        const joined = presented
            && await joinInvitedCompany({ companyId: String(assignCompany), invitation: presented, userId: authRes._id, provider });
        const invitedCompany = joined ? String(assignCompany) : '';

        const userDoc = {
            ...exports.buildUserDocument({ firstName, lastName, email, assignCompany: invitedCompany }),
            _id: authRes._id,
            isEmailVerified: true,
        };
        const userRes = await mongoRef.MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.USERS, data: userDoc }, 'save');

        return res.status(200).json({
            status: true,
            message: `${label} signup successful`,
            data: toAuthView(userRes),
        });
    } catch (error) {
        if (error instanceof SocialSignInRefusal) return refuse(error.statusCode, error.message);
        logger.error(`${provider} signup error: ${error.message}`);
        return refuse(500, error.message || 'Internal Server Error');
    }
};

exports.googleSignup = socialSignup('google');
exports.githubSignup = socialSignup('github');
exports.gitlabSignup = socialSignup('gitlab');

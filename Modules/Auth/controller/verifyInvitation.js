const logger = require("../../../Config/loggerConfig");
const { default: mongoose } = require("mongoose");
const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { dbCollections } = require("../../../Config/collections");
const { addAndRemoveUserInMongodbNotificationCount } = require("../controller");
const atob = (input) => Buffer.from(input, 'base64').toString('binary');
const { updateUserFun } = require("../../Users/controller");
const { updateMemberFunction } = require('../../settings/Members/controller');
const { importUserNotifications } = require("../../../utils/data");
const { recordInvitedOwner } = require("../../Company/helpers/recordInvitedOwner");
const { linkTokenAccepted } = require("./invitationPreview");

/* Only these keys are read from the link; anything else in it is ignored. */
const ALLOWED_INVITE_KEYS = new Set(['userId', 'companyId', 'linkId', 'docId']);

// Buffer decoding is permissive and returns garbage on malformed input, so gate on the alphabet first.
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

exports.parseInviteBlob = (encoded) => {
    if (typeof encoded !== 'string' || !encoded) return null;
    if (!BASE64_RE.test(encoded)) return null;
    let decoded;
    try {
        decoded = atob(encoded);
    } catch (_) {
        return null;
    }
    if (typeof decoded !== 'string' || !decoded) return null;
    const out = {};
    const parts = decoded.split('&');
    for (let i = 0; i < parts.length; i += 1) {
        const eq = parts[i].indexOf('=');
        if (eq < 0) continue;
        const key = parts[i].slice(0, eq);
        const value = parts[i].slice(eq + 1);
        if (ALLOWED_INVITE_KEYS.has(key)) {
            out[key] = value;
        }
    }
    if (Object.keys(out).length === 0) return null;
    return out;
};

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const PENDING = 1;
const ACCEPTED = 2;
const INVITATION_TTL_MS = 24 * 60 * 60 * 1000;

const isObjectId = (value) => OBJECT_ID_PATTERN.test(String(value || ''));
const isIdString = (value) => typeof value === 'string' && OBJECT_ID_PATTERN.test(value);
const normalizedEmail = (value) => String(value || '').trim().toLowerCase();

/* One answer for every refusal, so the link cannot be used to learn which accounts or
 * invitations exist. */
const refuse = (res) => res.json({ status: false, key: 1, statusText: 'Invalid URL.' });

/* An invitation names its account when the invitee was registered at send time; one sent
 * to an address with no account yet belongs to whoever proved they own that address. */
exports.invitationBindsAccount = (invitation, account) => {
    if (!invitation || !account || account.isDeleted === true || account.isActive === false) return false;
    const invitedUserId = String(invitation.userId || '');
    if (invitedUserId) return invitedUserId === String(account._id);
    return account.isEmailVerified === true
        && normalizedEmail(invitation.userEmail) !== ''
        && normalizedEmail(invitation.userEmail) === normalizedEmail(account.Employee_Email);
};

const findInvitation = (companyId, memberId) => MongoDbCrudOpration(companyId, {
    type: dbCollections.COMPANY_USERS,
    data: [{ _id: new mongoose.Types.ObjectId(String(memberId)), isDelete: { $ne: true } }]
}, 'findOne');

const findAccount = (userId) => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
    type: dbCollections.USERS,
    data: [{ _id: new mongoose.Types.ObjectId(String(userId)) }, { Employee_Email: 1, isEmailVerified: 1, isActive: 1, isDeleted: 1 }]
}, 'findOne');

const acceptable = (invitation, linkId, account) => Boolean(invitation)
    && invitation.status === PENDING
    && typeof linkId === 'string'
    && linkTokenAccepted(invitation.linkId, linkId)
    && exports.invitationBindsAccount(invitation, account);

/* Recorded as one conditional update, so a withdrawal or a second accept racing this one wins or loses whole. */
const claimInvitation = async (companyId, invitation, account) => {
    const userId = String(account._id);
    const claimed = await updateMemberFunction(companyId, [
        { _id: invitation._id, status: PENDING, linkId: invitation.linkId },
        { $set: { status: ACCEPTED, linkId: '', userId } },
        { returnDocument: 'after' }
    ], 'findOneAndUpdate');
    if (!claimed.data || !claimed.data._id) return false;

    await Promise.all([
        recordInvitedOwner({ companyId, invitation, userId }).catch((error) => {
            logger.error(`ERROR in record invited owner: ${error.message}`);
        }),
        updateUserFun(SCHEMA_TYPE.GOLBAL, {
            type: dbCollections.USERS,
            data: [{ _id: new mongoose.Types.ObjectId(userId) }, { $addToSet: { AssignCompany: companyId } }]
        }, 'updateOne', companyId, userId).catch((error) => {
            logger.error(`ERROR in update user: ${error.message}`);
        }),
    ]);
    importUserNotifications(companyId, userId).catch((error) => {
        logger.error(`ERROR in import notification settings: ${error}`);
    });
    addAndRemoveUserInMongodbNotificationCount(companyId, userId, 'Add').catch((error) => {
        logger.error(`ERROR in create user In mongodb: ${error}`);
    });
    return true;
};

exports.checkPermission = async (req, res) => {
    try {
        const invite = exports.parseInviteBlob(req.body && req.body.id);
        if (!invite || !isObjectId(invite.userId) || !isObjectId(invite.companyId) || !isObjectId(invite.docId) || !invite.linkId) {
            return refuse(res);
        }
        const [invitation, account] = await Promise.all([findInvitation(invite.companyId, invite.docId), findAccount(invite.userId)]);
        if (!acceptable(invitation, invite.linkId, account)) return refuse(res);
        if (new Date(invitation.sendInvitationTime).getTime() + INVITATION_TTL_MS < Date.now()) {
            return res.json({ status: false, key: 4, statusText: 'Link is Expired.' });
        }
        if (!(await claimInvitation(invite.companyId, invitation, account))) return refuse(res);
        res.json({ status: true, key: 5, companyId: invite.companyId });
    } catch (error) {
        logger.error(`Check Permission Error: ${error}`);
        if (!res.headersSent) refuse(res);
    }
};

const refuseSignedIn = (res) => res.status(403).json({ status: false, statusText: 'This invitation cannot be accepted.' });

/* The copied join link names no account, so the account is the signed-in one. Unlike the emailed link it
 * does not expire: it is useless without that account's session, and the preview it follows never expires
 * a pending invitation either. */
exports.acceptSignedIn = async (req, res) => {
    try {
        const { companyId, memberId, linkId } = req.body || {};
        if (req.apiToken || !isObjectId(req.uid) || !isIdString(companyId) || !isIdString(memberId)) {
            return refuseSignedIn(res);
        }
        const [invitation, account] = await Promise.all([findInvitation(companyId, memberId), findAccount(req.uid)]);
        if (!acceptable(invitation, linkId, account)) return refuseSignedIn(res);
        if (!(await claimInvitation(companyId, invitation, account))) return refuseSignedIn(res);
        return res.json({ status: true, statusText: 'Invitation accepted.', companyId });
    } catch (error) {
        logger.error(`accept invitation signed in: ${error?.message || error}`);
        if (!res.headersSent) refuseSignedIn(res);
    }
};

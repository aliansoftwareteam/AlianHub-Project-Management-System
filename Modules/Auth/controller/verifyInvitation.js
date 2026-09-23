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

exports.checkPermission = async (req, res) => {
    try {
        const invite = exports.parseInviteBlob(req.body && req.body.id);
        if (!invite || !isObjectId(invite.userId) || !isObjectId(invite.companyId) || !isObjectId(invite.docId) || !invite.linkId) {
            return refuse(res);
        }
        const docId = new mongoose.Types.ObjectId(invite.docId);
        const invitation = await MongoDbCrudOpration(invite.companyId, {
            type: dbCollections.COMPANY_USERS,
            data: [{ _id: docId, isDelete: { $ne: true } }]
        }, 'findOne');
        const account = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
            type: dbCollections.USERS,
            data: [{ _id: new mongoose.Types.ObjectId(invite.userId) }, { Employee_Email: 1, isEmailVerified: 1, isActive: 1, isDeleted: 1 }]
        }, 'findOne');
        if (!invitation
            || invitation.status !== PENDING
            || !linkTokenAccepted(invitation.linkId, invite.linkId)
            || !exports.invitationBindsAccount(invitation, account)) {
            return refuse(res);
        }
        if (new Date(invitation.sendInvitationTime).getTime() + INVITATION_TTL_MS < Date.now()) {
            return res.json({ status: false, key: 4, statusText: 'Link is Expired.' });
        }

        const userId = String(account._id);
        const claimed = await updateMemberFunction(invite.companyId, [
            { _id: docId, status: PENDING, linkId: invitation.linkId },
            { $set: { status: ACCEPTED, linkId: '', userId } },
            { returnDocument: 'after' }
        ], 'findOneAndUpdate');
        if (!claimed.data || !claimed.data._id) return refuse(res);

        await Promise.all([
            recordInvitedOwner({ companyId: invite.companyId, invitation, userId }).catch((error) => {
                logger.error(`ERROR in record invited owner: ${error.message}`);
            }),
            updateUserFun(SCHEMA_TYPE.GOLBAL, {
                type: dbCollections.USERS,
                data: [{ _id: new mongoose.Types.ObjectId(userId) }, { $addToSet: { AssignCompany: invite.companyId } }]
            }, 'updateOne', invite.companyId, userId).catch((error) => {
                logger.error(`ERROR in update user: ${error.message}`);
            }),
        ]);
        res.json({ status: true, key: 5, companyId: invite.companyId });

        importUserNotifications(invite.companyId, userId).catch((error) => {
            logger.error(`ERROR in import notification settings: ${error}`);
        });
        addAndRemoveUserInMongodbNotificationCount(invite.companyId, userId, 'Add').catch((error) => {
            logger.error(`ERROR in create user In mongodb: ${error}`);
        });
    } catch (error) {
        logger.error(`Check Permission Error: ${error}`);
        if (!res.headersSent) refuse(res);
    }
};

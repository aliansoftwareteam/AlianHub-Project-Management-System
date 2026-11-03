const mongoose = require('mongoose');
const hostingMode = require('../../Config/hostingMode');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { meetsPasswordRule, PASSWORD_RULE_MESSAGE } = require('../Auth/helpers/passwordRule');
const { hashPassword } = require('../Auth/helpers/passwordHash');
const { requestAddress } = require('../../utils/requestAddress');
const { recordAudit } = require('../Audit/recorder');
const ownerLinks = require('./ownerLinks');
const support = require('./supportSession');

const globalDb = (type, data, method) => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type, data }, method);
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const fail = (res, code, statusText, extra) => res.status(code).send({ status: false, statusText, ...(extra || {}) });
const tokenOf = (req) => (req.body && typeof req.body.token === 'string' ? req.body.token : '');

const LINK_GONE = 'This link has expired or was already used.';

const userById = (userId) => globalDb(SCHEMA_TYPE.USERS, [{ _id: oid(userId) }, { Employee_Email: 1, Employee_FName: 1, Employee_Name: 1, AssignCompany: 1, isSupportUser: 1, isProductOwner: 1 }], 'findOne');

/* The same session every sign-in ends in; its own failure answers 401. */
const startSession = (req, res, userId) => new Promise((resolve) => {
    const { finalizeSession } = require('../Auth/controller/loginSession');
    finalizeSession(req, res, String(userId), () => {
        fail(res, 401, (req.errorMessageObject && req.errorMessageObject.message) || 'The session could not be started.');
        resolve(false);
    }, (session) => {
        res.send({ status: true, statusText: 'Signed in.', data: { uid: session.uid } });
        resolve(true);
    });
});

const onlyHosted = (handler) => (req, res) => (hostingMode.isManaged() ? handler(req, res) : fail(res, 404, 'Not found.'));

/* POST /api/v2/auth/platform-login: the portal's "Open AlianHub" link for the owner, or the support
 * account's link for a support session. Two-factor accounts are sent to the normal sign-in. */
exports.platformLogin = onlyHosted(async (req, res) => {
    try {
        const userId = await ownerLinks.consumeOneTimeToken(tokenOf(req), ownerLinks.PURPOSE.LOGIN);
        const user = userId ? await userById(userId) : null;
        if (!user) return fail(res, 400, LINK_GONE, { key: 'expired' });
        if (user.isSupportUser && !support.isSupportSessionLive(userId)) return fail(res, 403, 'The support session has ended.', { key: 'ended' });
        if (!user.isSupportUser && !user.isProductOwner) return fail(res, 403, 'This link is not for this account.', { key: 'expired' });
        if (await ownerLinks.twoFactorOn(userId)) return fail(res, 409, 'This account uses two-factor sign-in.', { twoFactorRequired: true, email: user.Employee_Email });
        const signedIn = await startSession(req, res, userId);
        if (signedIn) {
            const actorName = user.isSupportUser ? support.supportActorLabel(userId) : user.Employee_Name;
            const action = user.isSupportUser ? 'platform.support_login' : 'platform.owner_login';
            ownerLinks.companiesOf(user).forEach((companyId) => recordAudit(companyId, { actorId: String(userId), actorName, action, entityType: 'user', entityId: String(userId), entityName: actorName, ip: requestAddress(req) }));
        }
        return undefined;
    } catch (error) {
        logger.error(`[platform] platform-login failed: ${error.message}`);
        return fail(res, 500, 'Sign-in failed.');
    }
});

/* POST /api/v2/auth/activation/verify: what the activation page shows before a password is chosen. */
exports.verifyActivation = onlyHosted(async (req, res) => {
    try {
        const userId = await ownerLinks.peekOneTimeToken(tokenOf(req), ownerLinks.PURPOSE.ACTIVATION);
        const user = userId ? await userById(userId) : null;
        if (!user) return fail(res, 400, LINK_GONE, { key: 'expired' });
        const companyId = ownerLinks.companiesOf(user)[0];
        const company = companyId ? await globalDb(SCHEMA_TYPE.COMPANIES, [{ _id: oid(companyId) }, { Cst_CompanyName: 1 }], 'findOne') : null;
        return res.send({ status: true, statusText: 'Activation link.', data: { email: user.Employee_Email, firstName: user.Employee_FName || '', workspace: (company && company.Cst_CompanyName) || '' } });
    } catch (error) {
        logger.error(`[platform] activation verify failed: ${error.message}`);
        return fail(res, 500, 'The link could not be checked.');
    }
});

/* POST /api/v2/auth/activate: sets the first password, ends activation, and signs the owner in. */
exports.activate = onlyHosted(async (req, res) => {
    const password = req.body && req.body.password;
    if (!meetsPasswordRule(password)) return fail(res, 400, PASSWORD_RULE_MESSAGE, { message: PASSWORD_RULE_MESSAGE });
    try {
        const userId = await ownerLinks.consumeOneTimeToken(tokenOf(req), ownerLinks.PURPOSE.ACTIVATION);
        if (!userId) return fail(res, 400, LINK_GONE, { key: 'expired' });
        await globalDb(SCHEMA_TYPE.USER_AUTH, [{ _id: oid(userId) }, { $set: { ...(await hashPassword(userId + password)), token: '' } }], 'updateOne');
        await globalDb(SCHEMA_TYPE.USERS, [{ _id: oid(userId) }, { $set: { isEmailVerified: true, verificationToken: '' }, $unset: { activationPending: 1 } }], 'updateOne');
        await startSession(req, res, userId);
        return undefined;
    } catch (error) {
        logger.error(`[platform] activation failed: ${error.message}`);
        return fail(res, 500, 'The password could not be set.');
    }
});

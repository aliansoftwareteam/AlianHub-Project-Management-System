const helperCtr = require('../helper');

const ACCOUNT_MAIL_ANSWER = "If an account needs it, we've sent a link.";
const OWNER_SET_PASSWORD_LEAD = 'Your workspace is ready, but this account has no password yet. Set one to sign in with your email and password; opening it from your AlianHub account keeps working too.';

const findHostedAccount = async (email) => {
    const address = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!address || !require('../../../Config/hostingMode').isManaged()) return null;
    const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
    const { dbCollections } = require('../../../Config/collections');
    const user = await MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: dbCollections.USERS,
        data: [{ Employee_Email: address, $or: [{ activationPending: true }, { isSupportUser: true }] }, { activationPending: 1, isSupportUser: 1, isProductOwner: 1 }],
    }, 'findOne');
    return user ? { address, user } : null;
};

/* Hosted only: an owner the platform created has no password until the activation link is used,
 * and the AlianHub Support account signs in through support-session links alone. Neither is sent a
 * reset, set-password or sign-in mail. */
const refusesPasswordMail = async (email) => {
    const found = await findHostedAccount(email);
    return Boolean(found && (found.user.activationPending === true || found.user.isSupportUser === true));
};

/* The owner who asks for a reset before ever setting a password gets their activation link instead,
 * at the owner address only, so "Forgot password" on the instance is a way in. It revokes any earlier
 * activation link. Resolves true when a mail was sent. */
const mailOwnerActivation = async (email) => {
    const found = await findHostedAccount(email);
    if (!found || found.user.activationPending !== true || found.user.isSupportUser === true || found.user.isProductOwner !== true) return false;
    const { activationLink } = require('../../Platform/ownerLinks');
    const { activationUrl } = await activationLink({ email: found.address });
    const mail = require('../../Template/passwordExpiredMail')(found.address, activationUrl, '', { lead: OWNER_SET_PASSWORD_LEAD });
    require('../../service.js').SendEmail(mail.subject, mail.mail, found.address, true, (result) => {
        if (!result.status) require('../../../Config/loggerConfig').error(`Owner activation mail was not sent: ${result.error}`);
    }, { accountMail: true });
    return true;
};

/* Every request counts, not only failed ones, because the answer no longer says whether a
 * mail went out. req.ip follows the app's trust proxy setting, so a client cannot choose
 * its own key with x-forwarded-for. */
const limitAccountMailRequests = (req, res, next) => {
    const email = typeof (req.body && req.body.email) === 'string' ? req.body.email : '';
    helperCtr.manageResetAttempt(req.ip, { email }, (verdict) => {
        if (verdict && verdict.status) return next();
        return res.status((verdict && verdict.statusCode) || 429).json({ status: false, message: (verdict && verdict.message) || 'Auth.too_many_request' });
    });
};

module.exports = { ACCOUNT_MAIL_ANSWER, refusesPasswordMail, mailOwnerActivation, limitAccountMailRequests };

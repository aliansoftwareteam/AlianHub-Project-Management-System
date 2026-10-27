const helperCtr = require('../helper');

const ACCOUNT_MAIL_ANSWER = "If an account needs it, we've sent a link.";

/* A hosted instance's owner the platform created has no password until the activation link is used;
 * no reset, set-password or sign-in mail goes to that account before then. */
const isActivationPending = async (email) => {
    const address = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!address || !require('../../../Config/hostingMode').isManaged()) return false;
    const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
    const { dbCollections } = require('../../../Config/collections');
    const user = await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.USERS, data: [{ Employee_Email: address, activationPending: true }, { activationPending: 1 }] }, 'findOne');
    return Boolean(user && user.activationPending === true);
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

module.exports = { ACCOUNT_MAIL_ANSWER, isActivationPending, limitAccountMailRequests };

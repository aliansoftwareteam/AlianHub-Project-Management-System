const helperCtr = require('../helper');

const ACCOUNT_MAIL_ANSWER = "If an account needs it, we've sent a link.";

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

module.exports = { ACCOUNT_MAIL_ANSWER, limitAccountMailRequests };
